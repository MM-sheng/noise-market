/* ============================================================================
 * NOISE // 纯随机市场 — global leaderboard Worker (Cloudflare Workers + KV)
 *
 * The client cannot be trusted to report its own score, so it doesn't.
 * On /submit the client sends only { name, seed, actions:[{t,pos}] }.
 * This Worker RE-SIMULATES the exact deterministic game from the seed,
 * applies the player's recorded moves, computes the true return & rank,
 * and only records the entry if the server itself confirms rank #1.
 *
 * Deploy:
 *   1) npm i -g wrangler            (or: npx wrangler ...)
 *   2) wrangler kv namespace create LB
 *      -> copy the id into wrangler.toml (see README)
 *   3) wrangler deploy
 *   4) put the resulting https://noise-lb.<you>.workers.dev URL into
 *      index.html  ->  const API_BASE = "...";
 * ==========================================================================*/

// ---- canonical parameters for the shared board (everyone on a level field) --
const CANON = { sigma: 0.01, cost: 2, len: 120 };
const MAX_BOARD = 50;
const KEY = "board:v1";

// ---------- deterministic core (BYTE-IDENTICAL to the client) ----------------
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function hashSeed(s){s=String(s);let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function newGauss(rng){let spare=null;return function(){if(spare!==null){const g=spare;spare=null;return g;}let u=0,v=0;while(u===0)u=rng();while(v===0)v=rng();const m=Math.sqrt(-2*Math.log(u));spare=m*Math.sin(2*Math.PI*v);return m*Math.cos(2*Math.PI*v);}}
const START=10000, PX=100, LB=6, BOT_SZ=5;
function mk(){return{pos:0,avg:0,real:0};}
function exec(a,side,qty,price,cost){
  if(qty<=0)return;
  if(a.pos===0||Math.sign(a.pos)===side){const t=Math.abs(a.pos)+qty;a.avg=(a.avg*Math.abs(a.pos)+price*qty)/t;a.pos+=side*qty;}
  else{const cq=Math.min(qty,Math.abs(a.pos));const pnl=cq*(price-a.avg)*Math.sign(a.pos);a.real+=pnl;a.pos+=side*qty;const rem=qty-cq;if(rem>0)a.avg=price;else if(a.pos===0)a.avg=0;}
  a.real-=qty*price*cost/10000;
}
function moveTo(a,pos,price,cost){const d=pos-a.pos;if(d!==0)exec(a,Math.sign(d),Math.abs(d),price,cost);}
const eqv=(a,price)=>START+a.real+a.pos*(price-a.avg);
const retv=(a,price)=>(eqv(a,price)/START-1)*100;

function simulate(seed, actions, sigma, cost, len){
  const rng=mulberry32(hashSeed(seed)), monkeyRng=mulberry32(hashSeed(seed)^0x9E3779B9), gauss=newGauss(rng);
  let price=PX, ticks=0, buf=[PX];
  const you=mk(), mom=mk(), con=mk(), bh=mk(), monkey=mk();
  const byTick=new Map();
  for(const a of (actions||[])){
    if(!byTick.has(a.t)) byTick.set(a.t, []);
    byTick.get(a.t).push(a.pos);
  }
  const applyActions=(t)=>{ for(const pos of (byTick.get(t)||[])) moveTo(you, pos, price, cost); };
  applyActions(0);
  for(let t=1;t<=len;t++){
    const r=-0.5*sigma*sigma+sigma*gauss(); price*=Math.exp(r); ticks++; buf.push(price);
    if(ticks>LB){const sig=Math.sign(price-buf[buf.length-1-LB]);
      if(sig){if(Math.sign(mom.pos)!==sig)moveTo(mom,sig*BOT_SZ,price,cost);if(Math.sign(con.pos)!==-sig)moveTo(con,-sig*BOT_SZ,price,cost);}}
    if(ticks===1) moveTo(bh, BOT_SZ, price, cost);
    if(monkeyRng()<0.05){const x=monkeyRng(),s=x<0.45?1:(x<0.9?-1:0);moveTo(monkey,s*BOT_SZ,price,cost);}
    applyActions(t);
  }
  const arr=[["you",you],["mom",mom],["con",con],["bh",bh],["monkey",monkey]]
    .map(([id,a])=>({id,ret:retv(a,price)})).sort((x,y)=>y.ret-x.ret);
  return { rank: arr.findIndex(b=>b.id==="you")+1, ret: retv(you,price) };
}

// ---------- validation ----------
function validActions(v, len){
  if(!Array.isArray(v) || v.length>200) return false;
  for(const a of v){
    if(typeof a!=="object"||a===null) return false;
    if(!Number.isInteger(a.t)||a.t<0||a.t>len) return false;
    if(!Number.isInteger(a.pos)||a.pos<-50||a.pos>50) return false;
  }
  return true;
}
function cleanName(n){ return String(n||"无名氏").replace(/[<>&"'\\]/g,"").trim().slice(0,16) || "无名氏"; }
function validSeed(s){ return typeof s==="string" && /^[\w\-:.]{1,32}$/.test(s); }

// ---------- CORS ----------
const CORS = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type",
  "Access-Control-Max-Age":"86400",
};
const json = (obj, status=200) => new Response(JSON.stringify(obj), {status, headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});

function cleanBoard(value){
  if(!Array.isArray(value)) return [];
  return value
    .filter(e=>e && Number.isFinite(Number(e.ret)) && Number(e.ret)>0 && validSeed(String(e.seed||"")))
    .map(e=>({
      name: cleanName(e.name),
      seed: String(e.seed),
      ret: Math.round(Number(e.ret)*1e4)/1e4,
      ts: Number.isInteger(e.ts) ? e.ts : Date.now(),
    }))
    .sort((a,b)=>b.ret-a.ret)
    .slice(0,MAX_BOARD);
}

async function getBoard(env){
  if(!env.LB) return [];
  const raw = await env.LB.get(KEY);
  try { return cleanBoard(raw?JSON.parse(raw):[]); } catch(e){ return []; }
}

export default {
  async fetch(req, env){
    const url = new URL(req.url);
    if(req.method==="OPTIONS") return new Response(null,{status:204,headers:CORS});

    if(url.pathname==="/leaderboard" && req.method==="GET"){
      const board = await getBoard(env);
      return json({ ok:true, board: board.slice(0,MAX_BOARD), players: board.slice(0,MAX_BOARD) });
    }

    if(url.pathname==="/submit" && req.method==="POST"){
      let body;
      try { body = await req.json(); } catch(e){ return json({ok:false,error:"bad json"},400); }
      const name = cleanName(body.name);
      const seed = String(body.seed||"");
      if(!validSeed(seed)) return json({ok:false,error:"bad seed"},400);
      if(!validActions(body.actions, CANON.len)) return json({ok:false,error:"bad actions"},400);

      // server recomputes the truth from seed + moves on canonical params
      const { rank, ret } = simulate(seed, body.actions, CANON.sigma, CANON.cost, CANON.len);
      if(rank!==1 || ret<=0) return json({ ok:false, reason:"not_first", rank, ret });

      const board = await getBoard(env);
      // dedupe by name+seed, keep best return
      const i = board.findIndex(e=>e.name===name && e.seed===seed);
      const entry = { name, seed, ret:Math.round(ret*1e4)/1e4, ts:Date.now() };
      if(i>=0){ if(ret>board[i].ret) board[i]=entry; }
      else board.push(entry);
      board.sort((a,b)=>b.ret-a.ret);
      const trimmed = board.slice(0,MAX_BOARD);
      await env.LB.put(KEY, JSON.stringify(trimmed));
      return json({ ok:true, rank, ret, board:trimmed, players:trimmed });
    }

    if(url.pathname==="/" ) return json({ ok:true, service:"noise-leaderboard", endpoints:["/leaderboard","/submit"] });
    return json({ ok:false, error:"not found" }, 404);
  }
};
