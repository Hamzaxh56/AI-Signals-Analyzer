const express=require("express"),http=require("http"),WebSocket=require("ws");
const app=express(),server=http.createServer(app),wss=new WebSocket.Server({server});
const PORT=process.env.PORT||10000;
app.use(express.static(__dirname));
app.get("/",(_,r)=>r.sendFile(__dirname+"/index.html"));
app.get("/health",(_,r)=>r.json({ok:true,service:"ai-market-signals",time:Date.now()}));

const M={
  Forex:{"EUR/USD":"EURUSD=X","GBP/USD":"GBPUSD=X","USD/JPY":"USDJPY=X","AUD/USD":"AUDUSD=X","USD/CAD":"CAD=X","USD/CHF":"CHF=X","NZD/USD":"NZDUSD=X","EUR/GBP":"EURGBP=X","GBP/JPY":"GBPJPY=X","EUR/JPY":"EURJPY=X"},
  Commodities:{"Gold":"GC=F","Silver":"SI=F","Crude Oil":"CL=F","Brent Oil":"BZ=F","Natural Gas":"NG=F","Copper":"HG=F"},
  Indices:{"S&P 500":"^GSPC","NASDAQ 100":"^NDX","Dow Jones":"^DJI","Russell 2000":"^RUT","DAX":"^GDAXI","FTSE 100":"^FTSE","Nikkei 225":"^N225","Hang Seng":"^HSI"},
  Crypto:{"Bitcoin":"BTC-USD","Ethereum":"ETH-USD","BNB":"BNB-USD","Solana":"SOL-USD","XRP":"XRP-USD","Cardano":"ADA-USD","Dogecoin":"DOGE-USD","Avalanche":"AVAX-USD"},
  Stocks:{"Apple":"AAPL","Microsoft":"MSFT","NVIDIA":"NVDA","Amazon":"AMZN","Alphabet":"GOOGL","Meta":"META","Tesla":"TSLA","AMD":"AMD","Netflix":"NFLX","Intel":"INTC","Coca-Cola":"KO","McDonald's":"MCD"}
};

const TF={
  "1m":["1m","1d"],"5m":["5m","5d"],"15m":["15m","1mo"],"30m":["30m","1mo"],
  "1h":["1h","3mo"],"4h":["1h","6mo"],"1d":["1d","2y"]
};

const send=(w,x)=>{if(w.readyState===WebSocket.OPEN)w.send(JSON.stringify(x))};

async function fetchJson(url){
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),12000);
  try{
    const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0","Accept":"application/json"},signal:ctl.signal});
    if(!r.ok)throw Error("Market feed unavailable ("+r.status+")");
    return await r.json();
  }finally{clearTimeout(timer)}
}

async function candles(sym,tf){
  const [iv,range]=TF[tf]||TF["5m"];
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${iv}&range=${range}&events=history`;
  const j=await fetchJson(url);
  const z=j?.chart?.result?.[0];
  if(!z?.timestamp?.length)throw Error("No market data returned");
  const q=z.indicators?.quote?.[0];
  if(!q)throw Error("Market candle data unavailable");
  const out=[];
  for(let i=0;i<z.timestamp.length;i++){
    const o=Number(q.open?.[i]),h=Number(q.high?.[i]),l=Number(q.low?.[i]),c=Number(q.close?.[i]),v=Number(q.volume?.[i]||0);
    if([o,h,l,c].every(Number.isFinite)&&h>=Math.max(o,c)&&l<=Math.min(o,c))
      out.push({time:z.timestamp[i]*1000,open:o,high:h,low:l,close:c,volume:v});
  }
  if(out.length<25)throw Error("Not enough live candles returned");
  return out.slice(-120);
}

function ema(a,n){
  if(a.length<n)return null;
  let e=a.slice(0,n).reduce((x,y)=>x+y,0)/n,k=2/(n+1);
  for(let i=n;i<a.length;i++)e=a[i]*k+e*(1-k);
  return e;
}
function rsi(a,n=14){
  if(a.length<=n)return 50;
  let g=0,l=0;
  for(let i=1;i<=n;i++){const d=a[i]-a[i-1];g+=Math.max(d,0);l+=Math.max(-d,0)}
  let ag=g/n,al=l/n;
  for(let i=n+1;i<a.length;i++){const d=a[i]-a[i-1];ag=(ag*(n-1)+Math.max(d,0))/n;al=(al*(n-1)+Math.max(-d,0))/n}
  return al===0?100:100-100/(1+ag/al);
}
function macd(a){
  const e12=ema(a,12),e26=ema(a,26);
  return e12!==null&&e26!==null?e12-e26:0;
}
function analyze(c){
  const a=c.map(x=>x.close),p=a.at(-1),e9=ema(a,9),e21=ema(a,21),e50=ema(a,50),r=rsi(a),m=macd(a);
  let score=0,reasons=[];
  if(p>e9){score++;reasons.push("Price above EMA 9")}else{score--;reasons.push("Price below EMA 9")}
  if(e9>e21){score+=2;reasons.push("EMA 9 above EMA 21")}else{score-=2;reasons.push("EMA 9 below EMA 21")}
  if(e21>e50){score+=2;reasons.push("EMA 21 above EMA 50")}else{score-=2;reasons.push("EMA 21 below EMA 50")}
  if(r>55&&r<75){score++;reasons.push("RSI bullish")}else if(r<45&&r>25){score--;reasons.push("RSI bearish")}else reasons.push("RSI neutral");
  if(m>0){score++;reasons.push("MACD positive")}else{score--;reasons.push("MACD negative")}
  const action=score>=4?"BUY":score<=-4?"SELL":"WAIT";
  const confidence=Math.min(95,Math.max(50,50+Math.abs(score)*6));
  return {
    price:p,ema9:e9,ema21:e21,ema50:e50,rsi:r,macd:m,action,confidence,
    trend:score>=3?"BULLISH":score<=-3?"BEARISH":"NEUTRAL",
    support:Math.min(...c.slice(-40).map(x=>x.low)),
    resistance:Math.max(...c.slice(-40).map(x=>x.high)),reasons
  };
}
async function load(w,q,generated=false){
  const group=M[q.group]||M.Forex,name=q.name&&group[q.name]?q.name:Object.keys(group)[0],sym=group[name],tf=TF[q.tf]?q.tf:"5m";
  try{
    const c=await candles(sym,tf),a=analyze(c);
    send(w,{type:"data",group,name,symbol:sym,tf,candles:c,analysis:a,updated:Date.now(),generated});
  }catch(e){send(w,{type:"error",message:e.name==="AbortError"?"Market feed timed out. Try again.":e.message})}
}
wss.on("connection",w=>{
  send(w,{type:"status",ok:true});
  w.on("message",async b=>{
    try{
      const q=JSON.parse(b);
      if(q.type==="markets")send(w,{type:"markets",markets:M});
      else if(q.type==="load"||q.type==="generate")await load(w,q,q.type==="generate");
    }catch(e){send(w,{type:"error",message:"Request error"})}
  });
});
setInterval(()=>wss.clients.forEach(w=>{if(w.readyState===WebSocket.OPEN)w.ping()}),30000);
server.listen(PORT,"0.0.0.0",()=>console.log("AI Signals V3 running on "+PORT));
