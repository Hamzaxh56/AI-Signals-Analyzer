const express=require('express');
const http=require('http');
const WebSocket=require('ws');

const app=express();
const server=http.createServer(app);
const wss=new WebSocket.Server({server});
const PORT=process.env.PORT||10000;
app.use(express.json({limit:'64kb'}));
app.use(express.static(__dirname));
app.get('/',(_,r)=>r.sendFile(__dirname+'/index.html'));
app.get('/health',(_,r)=>r.json({ok:true,service:'quotex-price-sync-analyzer',mode:'quotex-sync-ready',time:Date.now()}));

// IMPORTANT: Quotex does not publish a documented public quote API in the official
// material checked for this project. Therefore this build never pretends that a
// third-party feed is the Quotex quote. A current Quotex quote can be pushed into
// this app through the /api/quotex-sync endpoint (for example by an authorized
// integration/bridge you control). No login, password, cookie, or session token is
// accepted by this endpoint.
const M={
 Forex:{'EUR/USD':'EURUSD','GBP/USD':'GBPUSD','USD/JPY':'USDJPY','AUD/USD':'AUDUSD','USD/CAD':'USDCAD','USD/CHF':'USDCHF','NZD/USD':'NZDUSD','EUR/GBP':'EURGBP','GBP/JPY':'GBPJPY','EUR/JPY':'EURJPY','USD/TRY':'USDTRY','USD/SGD':'USDSGD'},
 Commodities:{'Gold':'XAUUSD','Silver':'XAGUSD','Crude Oil':'USOIL','Brent Oil':'UKOIL','Natural Gas':'NATGAS','Copper':'XCUUSD'},
 Indices:{'S&P 500':'US500','NASDAQ 100':'NAS100','Dow Jones':'US30','Russell 2000':'US2000','DAX':'GER40','FTSE 100':'UK100','Nikkei 225':'JPN225','Hang Seng':'HK50'},
 Crypto:{'Bitcoin':'BTCUSD','Ethereum':'ETHUSD','BNB':'BNBUSD','Solana':'SOLUSD','XRP':'XRPUSD','Cardano':'ADAUSD','Dogecoin':'DOGEUSD','Avalanche':'AVAXUSD'},
 Stocks:{'Apple':'AAPL','Microsoft':'MSFT','NVIDIA':'NVDA','Amazon':'AMZN','Alphabet':'GOOGL','Meta':'META','Tesla':'TSLA','AMD':'AMD','Netflix':'NFLX','Intel':'INTC','Coca-Cola':'KO',"McDonald\\'s":'MCD'}
};
const TF={'1m':'1m','5m':'5m'};
const quotexQuotes=new Map();
const send=(w,x)=>{if(w.readyState===WebSocket.OPEN)w.send(JSON.stringify(x))};
function broadcast(x){wss.clients.forEach(w=>send(w,x));}
function normSymbol(x){return String(x||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');}
function resolveSymbol(q){const group=M[q.group]||M.Forex; const name=q.name&&group[q.name]?q.name:Object.keys(group)[0]; return {group,name,symbol:group[name]};}
async function fetchJson(url){
 const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),10000);
 try{const r=await fetch(url,{headers:{Accept:'application/json'},signal:ctl.signal});const t=await r.text();let j;try{j=JSON.parse(t)}catch{throw Error('Public market feed returned invalid JSON')}if(!r.ok)throw Error(j?.message||`Market feed unavailable (${r.status})`);return j}
 finally{clearTimeout(timer)}
}
async function getBars(symbol,tf){
 const interval=TF[tf];
 const ohlc=await fetchJson(`https://biquote.io/api/${encodeURIComponent(symbol)}/ohlc?interval=${interval}&limit=160`);
 let bars=(ohlc?.bars||[]).map(b=>({time:new Date(b.openTime).getTime(),open:+b.open,high:+b.high,low:+b.low,close:+b.close,volume:+(b.volume||b.tickVolume||0),isOpen:!!b.isOpen})).filter(b=>[b.time,b.open,b.high,b.low,b.close].every(Number.isFinite));
 bars.sort((a,b)=>a.time-b.time); if(bars.length<55)throw Error(`Not enough ${tf} candles returned for this symbol`); return bars.slice(-160);
}
async function getMarketPair(symbol){
 const [one,five,tick]=await Promise.all([getBars(symbol,'1m'),getBars(symbol,'5m'),fetchJson(`https://biquote.io/api/${encodeURIComponent(symbol)}?allowStale=true`)]);
 const publicLive=+tick?.mid; const q=quotexQuotes.get(normSymbol(symbol));
 const synced= q && Number.isFinite(q.price) ? q : null;
 const live=synced?.price ?? publicLive;
 for(const bars of [one,five]){if(Number.isFinite(live)){const last=bars.at(-1);last.close=live;last.high=Math.max(last.high,live);last.low=Math.min(last.low,live);last.isOpen=true;}}
 return {bars:{'1m':one,'5m':five},tick,quotexSync:synced,source:synced?'QUOTEX CURRENT PRICE SYNC':'PUBLIC MARKET FALLBACK'};
}
function ema(a,n){if(a.length<n)return null;let e=a.slice(0,n).reduce((x,y)=>x+y,0)/n,k=2/(n+1);for(let i=n;i<a.length;i++)e=a[i]*k+e*(1-k);return e}
function rsi(a,n=14){if(a.length<=n)return 50;let g=0,l=0;for(let i=1;i<=n;i++){let d=a[i]-a[i-1];g+=Math.max(d,0);l+=Math.max(-d,0)}let ag=g/n,al=l/n;for(let i=n+1;i<a.length;i++){let d=a[i]-a[i-1];ag=(ag*(n-1)+Math.max(d,0))/n;al=(al*(n-1)+Math.max(-d,0))/n}return al===0?100:100-100/(1+ag/al)}
function atr(c,n=14){if(c.length<=n)return 0;let tr=[];for(let i=1;i<c.length;i++)tr.push(Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close)));return tr.slice(-n).reduce((x,y)=>x+y,0)/Math.min(n,tr.length)}
function macd(a){return ema(a,12)-ema(a,26)}
function analyze(c){
 const a=c.map(x=>x.close),p=a.at(-1),e9=ema(a,9),e21=ema(a,21),e50=ema(a,50),r=rsi(a),m=macd(a),at=atr(c); let score=0,reasons=[];
 if(p>e9){score++;reasons.push('Price above EMA 9')}else{score--;reasons.push('Price below EMA 9')}
 if(e9>e21){score+=2;reasons.push('EMA 9 above EMA 21')}else{score-=2;reasons.push('EMA 9 below EMA 21')}
 if(e21>e50){score+=2;reasons.push('EMA 21 above EMA 50')}else{score-=2;reasons.push('EMA 21 below EMA 50')}
 if(r>=55&&r<75){score++;reasons.push('RSI bullish zone')}else if(r<=45&&r>25){score--;reasons.push('RSI bearish zone')}else reasons.push('RSI neutral/extended');
 if(m>0){score++;reasons.push('MACD positive')}else{score--;reasons.push('MACD negative')}
 const last=c.at(-1),body=Math.abs(last.close-last.open),range=Math.max(last.high-last.low,1e-12); if(body/range>.55){if(last.close>last.open){score++;reasons.push('Strong bullish candle')}else{score--;reasons.push('Strong bearish candle')}}
 const action=score>=4?'BUY':score<=-4?'SELL':'WAIT'; const confidence=Math.min(95,Math.max(50,50+Math.abs(score)*5));
 return {price:p,ema9:e9,ema21:e21,ema50:e50,rsi:r,macd:m,atr:at,action,confidence,trend:score>=3?'BULLISH':score<=-3?'BEARISH':'NEUTRAL',support:Math.min(...c.slice(-40).map(x=>x.low)),resistance:Math.max(...c.slice(-40).map(x=>x.high)),reasons,score,candle:last.close>last.open?'BULLISH':last.close<last.open?'BEARISH':'DOJI'};
}
async function load(w,q,generated=false){
 const {group,name,symbol}=resolveSymbol(q);
 try{const market=await getMarketPair(symbol);const signals={'1m':analyze(market.bars['1m']),'5m':analyze(market.bars['5m'])};const tf=TF[q.tf]?q.tf:'1m';send(w,{type:'data',group,name,symbol,tf,candles:market.bars[tf],signals,analysis:signals[tf],tick:market.tick,quotexSync:market.quotexSync,source:market.source,updated:Date.now(),generated});}
 catch(e){send(w,{type:'error',message:e.name==='AbortError'?'Public market feed timeout.':e.message,symbol,tf:q.tf||'1m'})}
}

// Push only a current quote. This is deliberately credential-free.
app.post('/api/quotex-sync',async(req,res)=>{
 try{
  const price=Number(req.body?.price); const symbol=normSymbol(req.body?.symbol); if(!symbol||!Number.isFinite(price)||price<=0) return res.status(400).json({ok:false,error:'Provide symbol and positive price'});
  const timestamp=Number(req.body?.timestamp)||Date.now(); const item={symbol,price,timestamp,receivedAt:Date.now()}; quotexQuotes.set(symbol,item);
  broadcast({type:'quotex_sync',symbol,price,timestamp,receivedAt:item.receivedAt}); return res.json({ok:true,item});
 }catch(e){return res.status(500).json({ok:false,error:'Sync error'})}
});
app.delete('/api/quotex-sync/:symbol',async(req,res)=>{quotexQuotes.delete(normSymbol(req.params.symbol));res.json({ok:true});});
app.get('/api/quotex-sync/:symbol',async(req,res)=>{const q=quotexQuotes.get(normSymbol(req.params.symbol));res.json({ok:true,quote:q||null});});

wss.on('connection',w=>{send(w,{type:'status',ok:true});w.on('message',async b=>{try{const q=JSON.parse(b);if(q.type==='markets')send(w,{type:'markets',markets:M});else if(q.type==='load'||q.type==='generate')await load(w,q,q.type==='generate')}catch(e){send(w,{type:'error',message:'Request error'})}})});
setInterval(()=>wss.clients.forEach(w=>{if(w.readyState===WebSocket.OPEN)w.ping()}),30000);
server.listen(PORT,'0.0.0.0',()=>console.log(`Quotex price-sync analyzer running on ${PORT}`));
