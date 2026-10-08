const express=require("express"),http=require("http"),WebSocket=require("ws");
const app=express(),server=http.createServer(app),wss=new WebSocket.Server({server});
const PORT=process.env.PORT||10000;
app.use(express.static(__dirname));app.get("/",(_,r)=>r.sendFile(__dirname+"/index.html"));
app.get("/health",(_,r)=>r.json({ok:true}));

const M={
Forex:{"EUR/USD":"EURUSD=X","GBP/USD":"GBPUSD=X","USD/JPY":"USDJPY=X","AUD/USD":"AUDUSD=X","USD/CAD":"CAD=X","USD/CHF":"CHF=X","NZD/USD":"NZDUSD=X","EUR/GBP":"EURGBP=X","GBP/JPY":"GBPJPY=X","EUR/JPY":"EURJPY=X"},
Commodities:{"Gold":"GC=F","Silver":"SI=F","Crude Oil":"CL=F","Brent Oil":"BZ=F","Natural Gas":"NG=F","Copper":"HG=F"},
Indices:{"S&P 500":"^GSPC","NASDAQ 100":"^NDX","Dow Jones":"^DJI","Russell 2000":"^RUT","DAX":"^GDAXI","FTSE 100":"^FTSE","Nikkei 225":"^N225","Hang Seng":"^HSI"},
Crypto:{"Bitcoin":"BTC-USD","Ethereum":"ETH-USD","BNB":"BNB-USD","Solana":"SOL-USD","XRP":"XRP-USD","Cardano":"ADA-USD","Dogecoin":"DOGE-USD","Avalanche":"AVAX-USD"},
Stocks:{"Apple":"AAPL","Microsoft":"MSFT","NVIDIA":"NVDA","Amazon":"AMZN","Alphabet":"GOOGL","Meta":"META","Tesla":"TSLA","AMD":"AMD","Netflix":"NFLX","Intel":"INTC","Coca-Cola":"KO","McDonald's":"MCD"}
};
const TF={"1m":["1m","1d"],"5m":["5m","5d"],"15m":["15m","1mo"],"30m":["30m","1mo"],"1h":["1h","3mo"],"4h":["1h","6mo"],"1d":["1d","2y"]};
const send=(w,x)=>w.readyState===1&&w.send(JSON.stringify(x));
async function candles(sym,tf){
 const [iv,range]=TF[tf]||TF["5m"];
 const u=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${iv}&range=${range}&events=history`;
 const r=await fetch(u,{headers:{"User-Agent":"Mozilla/5.0"}});if(!r.ok)throw Error("Market feed unavailable ("+r.status+")");
 const j=await r.json(),z=j.chart?.result?.[0];if(!z)throw Error("No market data");
 const q=z.indicators.quote[0],out=[];
 for(let i=0;i<(z.timestamp||[]).length;i++){let o=q.open?.[i],h=q.high?.[i],l=q.low?.[i],c=q.close?.[i];if([o,h,l,c].every(Number.isFinite))out.push({time:z.timestamp[i]*1000,open:o,high:h,low:l,close:c,volume:q.volume?.[i]||0})}
 return out.slice(-180);
}
function ema(a,n){if(a.length<n)return null;let e=a.slice(0,n).reduce((x,y)=>x+y,0)/n,k=2/(n+1);for(let i=n;i<a.length;i++)e=a[i]*k+e*(1-k);return e}
function rsi(a,n=14){if(a.length<=n)return 50;let g=0,l=0;for(let i=1;i<=n;i++){let d=a[i]-a[i-1];g+=Math.max(d,0);l+=Math.max(-d,0)}let ag=g/n,al=l/n;for(let i=n+1;i<a.length;i++){let d=a[i]-a[i-1];ag=(ag*(n-1)+Math.max(d,0))/n;al=(al*(n-1)+Math.max(-d,0))/n}return al?100-100/(1+ag/al):100}
function analyze(c){
 const a=c.map(x=>x.close),p=a.at(-1),e9=ema(a,9),e21=ema(a,21),e50=ema(a,50),r=rsi(a);
 let score=0,reasons=[];
 if(p>e9){score+=1;reasons.push("Price above EMA 9")}else{score--;reasons.push("Price below EMA 9")}
 if(e9>e21){score+=2;reasons.push("EMA 9 > EMA 21")}else{score-=2;reasons.push("EMA 9 < EMA 21")}
 if(e21>e50){score+=2;reasons.push("EMA 21 > EMA 50")}else{score-=2;reasons.push("EMA 21 < EMA 50")}
 if(r>55&&r<75){score+=1;reasons.push("RSI bullish")}else if(r<45&&r>25){score-=1;reasons.push("RSI bearish")}
 let action=score>=4?"BUY":score<=-4?"SELL":"WAIT";
 let confidence=Math.min(95,Math.max(50,50+Math.abs(score)*7));
 return {price:p,ema9:e9,ema21:e21,ema50:e50,rsi:r,action,confidence,trend:score>=3?"BULLISH":score<=-3?"BEARISH":"NEUTRAL",support:Math.min(...c.slice(-40).map(x=>x.low)),resistance:Math.max(...c.slice(-40).map(x=>x.high)),reasons};
}
async function load(w,q){
 const group=M[q.group]||M.Forex,name=q.name||Object.keys(group)[0],sym=group[name],tf=TF[q.tf]?q.tf:"5m";
 try{const c=await candles(sym,tf),a=analyze(c);send(w,{type:"data",group,name,symbol:sym,tf,candles:c,analysis:a,updated:Date.now()})}
 catch(e){send(w,{type:"error",message:e.message})}
}
wss.on("connection",w=>{send(w,{type:"status",ok:true});w.on("message",async b=>{try{let q=JSON.parse(b);if(q.type==="markets")send(w,{type:"markets",markets:M});if(q.type==="load")await load(w,q)}catch(e){send(w,{type:"error",message:"Request error"})}})});
setInterval(()=>wss.clients.forEach(w=>w.readyState===1&&w.ping()),30000);
server.listen(PORT,"0.0.0.0",()=>console.log("AI Signals V2 running on "+PORT));
