import { ALL_FLOPS } from '../packages/odds-engine/src/flops.ts';
import { getSelection } from '../packages/odds-engine/src/markets.ts';
import { settle } from '../packages/odds-engine/src/settle.ts';
import { formatCard } from '../packages/odds-engine/src/cards.ts';
import book from '../docs/odds-book.json' with { type: 'json' };
import { clubs, tables, defaultFavorites, familyLabels } from './data.mjs';

export const catalogue = book.markets.flatMap(m => m.selections.filter(s => s.prices.direct.odds).map(s => ({
  id:s.id, label:s.label, market:m.name, description:m.description, family:m.family,
  familyLabel:familyLabels[m.family], oddsCenti:Math.round(s.prices.direct.odds*100), probability:s.probability,
})));
const byId = new Map(catalogue.map(s => [s.id,s]));
const cookieName = 'preflop_session';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sessionsFor = 60*60*24*90;
const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
class ApiError extends Error { constructor(status,message){super(message);this.status=status;} }
const json = (data,status=200,extra={}) => new Response(JSON.stringify(data),{status,headers:{...headers,...extra}});
async function hash(text){ return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join(''); }
export function randomFlop(){
  const size=ALL_FLOPS.length, bound=Math.floor(2**32/size)*size; let n;
  do { n=crypto.getRandomValues(new Uint32Array(1))[0]; } while(n>=bound);
  return ALL_FLOPS[n%size];
}
async function state(db,id){
  const p=await db.prepare('SELECT * FROM profiles WHERE id=?').bind(id).first();
  if(!p) throw new ApiError(401,'Your practice session has expired. Reload to start a new one.');
  return {name:p.name,balance:p.balance,version:p.version,favorites:JSON.parse(p.favorites),favoriteTables:JSON.parse(p.favorite_tables),createdAt:p.created_at};
}
const history = async(db,id) => (await db.prepare('SELECT * FROM rounds WHERE profile_id=? ORDER BY created_at DESC, rowid DESC LIMIT 100').bind(id).all()).results.map(receipt);
function receipt(r){return {id:r.id,tableId:r.table_id,selectionId:r.selection_id,stake:r.stake,oddsCenti:r.odds_centi,payout:r.payout,net:r.payout-r.stake,won:!!r.won,cards:JSON.parse(r.cards),balanceBefore:r.balance_before,balanceAfter:r.balance_after,createdAt:r.created_at};}
async function identity(req,db,create=false){
  const token=(req.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  if(token && /^[a-f0-9-]{73}$/.test(token)){
    const id=await hash(token);const p=await db.prepare('SELECT id FROM profiles WHERE id=? AND expires_at>?').bind(id,Date.now()).first();
    if(p)return {id};
  }
  if(!create)throw new ApiError(401,'Your practice session has expired. Reload to continue.');
  const fresh=crypto.randomUUID()+'-'+crypto.randomUUID(), id=await hash(fresh), now=Date.now();
  await db.prepare('INSERT INTO profiles (id,name,balance,version,favorites,favorite_tables,created_at,expires_at) VALUES (?,?,10000,0,?,?,?,?)').bind(id,'Player',JSON.stringify(defaultFavorites),'[]',now,now+sessionsFor*1000).run();
  return {id,cookie:`${cookieName}=${fresh}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionsFor}${new URL(req.url).protocol==='https:'?'; Secure':''}`};
}
async function body(req){
  if(!req.headers.get('content-type')?.startsWith('application/json'))throw new ApiError(415,'Send a JSON request.');
  const text=await req.text(); if(text.length>4096)throw new ApiError(413,'Request is too large.');
  try{const v=JSON.parse(text);if(!v||typeof v!=='object'||Array.isArray(v))throw 0;return v;}catch{throw new ApiError(400,'This request could not be read.');}
}
function checkOrigin(req){
  if(req.headers.get('origin')!==new URL(req.url).origin || req.headers.get('x-preflop-request')!=='1')throw new ApiError(403,'Please use the PreFlop app to make this change.');
}
async function play(db,id,b){
  if(!uuid.test(b.requestId||''))throw new ApiError(400,'Missing valid round request ID.');
  const existing=await db.prepare('SELECT * FROM rounds WHERE profile_id=? AND id=?').bind(id,b.requestId).first();
  if(existing){
    if(existing.table_id!==b.tableId||existing.selection_id!==b.selectionId||existing.stake!==b.stake||existing.odds_centi!==b.oddsCenti)throw new ApiError(409,'This request ID already belongs to another prediction.');
    return {round:receipt(existing),profile:await state(db,id)};
  }
  const table=tables.find(t=>t.id===b.tableId),selection=byId.get(b.selectionId);
  if(!table?.available)throw new ApiError(409,'This practice table is unavailable. Please choose another.');
  if(!selection)throw new ApiError(400,'This selection is not offered.');
  if(b.oddsCenti!==selection.oddsCenti)throw new ApiError(409,'The odds have changed. Reload the catalogue before playing.');
  if(!Number.isSafeInteger(b.stake)||b.stake<10||b.stake>1000)throw new ApiError(400,'Choose between 10 and 1,000 whole free chips.');
  const flop=randomFlop();
  const outcome=settle({betId:b.requestId,selectionId:b.selectionId,stakeMinor:b.stake,oddsCenti:selection.oddsCenti},flop);
  for(let attempt=0;attempt<5;attempt++){
    const p=await state(db,id); if(p.balance<b.stake)throw new ApiError(409,'Not enough free chips. Choose a smaller amount or refill in Profile.');
    const after=p.balance-b.stake+outcome.payoutMinor;
    try{
      await db.batch([
        db.prepare('UPDATE profiles SET balance=?, version=version+1 WHERE id=? AND version=? AND balance>=?').bind(after,id,p.version,b.stake),
        db.prepare('INSERT INTO rounds (id,profile_id,table_id,selection_id,stake,odds_centi,payout,won,cards,balance_before,balance_after,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE changes()=1').bind(b.requestId,id,table.id,selection.id,b.stake,selection.oddsCenti,outcome.payoutMinor,outcome.status==='won'?1:0,JSON.stringify(flop.cards.map(formatCard)),p.balance,after,Date.now()),
      ]);
    }catch(error){
      const saved=await db.prepare('SELECT * FROM rounds WHERE profile_id=? AND id=?').bind(id,b.requestId).first();
      if(!saved)throw error;
      if(saved.table_id!==b.tableId||saved.selection_id!==b.selectionId||saved.stake!==b.stake||saved.odds_centi!==b.oddsCenti)throw new ApiError(409,'This request ID already belongs to another prediction.');
    }
    const saved=await db.prepare('SELECT * FROM rounds WHERE profile_id=? AND id=?').bind(id,b.requestId).first();
    if(saved)return {round:receipt(saved),profile:await state(db,id)};
  }
  throw new ApiError(409,'Another round changed your balance. Please retry this prediction.');
}

export async function api(req,env){
  try{
    const db=env.DB;if(!db)throw new ApiError(503,'Practice storage is unavailable. Please try again shortly.');
    const url=new URL(req.url),path=url.pathname;
    if(!['GET','POST'].includes(req.method))throw new ApiError(405,'Method not allowed.');
    if(req.method==='POST')checkOrigin(req);
    const ident=await identity(req,db,path==='/api/bootstrap'&&req.method==='GET');
    const extra=ident.cookie?{'Set-Cookie':ident.cookie}:{};
    if(path==='/api/bootstrap'&&req.method==='GET')return json({profile:await state(db,ident.id),history:await history(db,ident.id),clubs,tables,catalogue,families:familyLabels,mode:'practice'},200,extra);
    if(path==='/api/history'&&req.method==='GET')return json({history:await history(db,ident.id),profile:await state(db,ident.id)});
    if(path.startsWith('/api/round/')&&req.method==='GET'){
      const r=await db.prepare('SELECT * FROM rounds WHERE profile_id=? AND id=?').bind(ident.id,path.slice(11)).first();
      if(!r)throw new ApiError(404,'No completed round found for this request.');
      return json({round:receipt(r),profile:await state(db,ident.id)});
    }
    if(req.method!=='POST')throw new ApiError(404,'Not found.');
    const b=await body(req);
    if(path==='/api/round')return json(await play(db,ident.id,b));
    if(path==='/api/favorites'){
      if(!Array.isArray(b.ids)||b.ids.length!==6||new Set(b.ids).size!==6||b.ids.some(id=>!byId.has(id)))throw new ApiError(400,'Choose six different selections from the catalogue.');
      const update=await db.prepare('UPDATE profiles SET favorites=?,version=version+1 WHERE id=? AND version=?').bind(JSON.stringify(b.ids),ident.id,b.version).run();
      if(!update.meta.changes)throw new ApiError(409,'Your favorites changed in another tab. Refresh and try again.');
      return json({profile:await state(db,ident.id)});
    }
    if(path==='/api/profile'){
      const name=typeof b.name==='string'?b.name.trim():'';
      if(name.length<1||name.length>30)throw new ApiError(400,'Use a display name between 1 and 30 characters.');
      await db.prepare('UPDATE profiles SET name=?,version=version+1 WHERE id=?').bind(name,ident.id).run();
      return json({profile:await state(db,ident.id)});
    }
    if(path==='/api/table-favorite'){
      if(!tables.some(t=>t.id===b.tableId))throw new ApiError(400,'Unknown table.');
      const p=await state(db,ident.id),ids=new Set(p.favoriteTables); if(b.saved===true)ids.add(b.tableId);else if(b.saved===false)ids.delete(b.tableId);else throw new ApiError(400,'Choose save or remove.');
      const update=await db.prepare('UPDATE profiles SET favorite_tables=?,version=version+1 WHERE id=? AND version=?').bind(JSON.stringify([...ids]),ident.id,p.version).run();
      if(!update.meta.changes)throw new ApiError(409,'Your profile changed. Please retry.');
      return json({profile:await state(db,ident.id)});
    }
    if(path==='/api/refill'){
      await db.prepare('UPDATE profiles SET balance=10000,version=version+1 WHERE id=? AND balance<1000').bind(ident.id).run();
      return json({profile:await state(db,ident.id)});
    }
    throw new ApiError(404,'Not found.');
  }catch(error){
    if(!error.status)console.error('PreFlop storage operation failed:',error.message);
    return json({error:error.status?error.message:'We could not save this change. Retry safely; a round will never be charged twice.'},error.status||503);
  }
}
