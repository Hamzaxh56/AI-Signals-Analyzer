const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 10000;

app.use(express.static(__dirname));
app.get("/", (_, res) => res.sendFile(__dirname + "/index.html"));
app.get("/health", (_, res) => res.json({ok:true, service:"all-market-analyzer"}));

const MARKETS = {
  forex: {
    "EUR/USD":"EURUSD=X","GBP/USD":"GBPUSD=X","USD/JPY":"USDJPY=X",
    "AUD/USD":"AUDUSD=X","USD/CAD":"CAD=X","USD/CHF":"CHF=X",
    "NZD/USD":"NZDUSD=X","EUR/GBP":"EURGBP=X","GBP/JPY":"GBPJPY=X",
    "EUR/JPY":"EURJPY=X"
  },
  commodities: {
    "Gold":"GC=F","Silver":"SI=F","Crude Oil":"CL=F","Brent Oil":"BZ=F",
    "Natural Gas":"NG=F","Copper":"HG=F"
  },
  indices: {
    "S&P 500":"^GSPC","NASDAQ 100":"^NDX","Dow Jones":"^DJI",
    "Russell 2000":"^RUT","DAX":"^GDAXI","FTSE 100":"^FTSE",
    "Nikkei 225":"^N225","Hang Seng":"^HSI"
  },
  crypto: {
    "Bitcoin":"BTC-USD","Ethereum":"ETH-USD","BNB":"BNB-USD",
    "Solana":"SOL-USD","XRP":"XRP-USD","Cardano":"ADA-USD",
    "Dogecoin":"DOGE-USD","Avalanche":"AVAX-USD"
  },
  stocks: {
    "Apple":"AAPL","Microsoft":"MSFT","NVIDIA":"NVDA","Amazon":"AMZN",
    "Alphabet":"GOOGL","Meta":"META","Tesla":"TSLA","AMD":"AMD",
    "Netflix":"NFLX","Intel":"INTC","Coca-Cola":"KO","McDonald's":"MCD"
  }
};

const INTERVALS = {
  "1m":{interval:"1m",range:"1d"},"5m":{interval:"5m",range:"5d"},
  "15m":{interval:"15m",range:"1mo"},"30m":{interval:"30m",range:"1mo"},
  "1h":{interval:"1h",range:"3mo"},"4h":{interval:"1h",range:"6mo"},
  "1d":{interval:"1d",range:"2y"}
};

function send(ws, obj){ if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(obj)); }

async function yahoo(symbol, tf){
  const cfg=INTERVALS[tf]||INTERVALS["5m"];
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${cfg.interval}&range=${cfg.range}&events=history`;
  const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0"}});
  if(!r.ok) throw new Error(`Market feed HTTP ${r.status}`);
  const j=await r.json();
  const res=j.chart?.result?.[0];
  if(!res) throw new Error("No market data returned");
  const q=res.indicators.quote[0];
  const candles=[];
  for(let i=0;i<(res.timestamp||[]).length;i++){
    const o=q.open?.[i],h=q.high?.[i],l=q.low?.[i],c=q.close?.[i],v=q.volume?.[i]||0;
    if([o,h,l,c].every(Number.isFinite)) candles.push({time:res.timestamp[i]*1000,open:o,high:h,low:l,close:c,volume:v});
  }
  if(!candles.length) throw new Error("No usable candles");
  return candles.slice(-300);
}

function ema(values,n){
  if(values.length<n) return null;
  let e=values.slice(0,n).reduce((a,b)=>a+b,0)/n, k=2/(n+1);
  for(let i=n;i<values.length;i++) e=values[i]*k+e*(1-k);
  return e;
}
function rsi(values,n=14){
  if(values.length<=n) return 50;
  let gain=0,loss=0;
  for(let i=1;i<=n;i++){let d=values[i]-values[i-1]; if(d>=0) gain+=d; else loss-=d;}
  let ag=gain/n, al=loss/n;
  for(let i=n+1;i<values.length;i++){let d=values[i]-values[i-1]; ag=((ag*(n-1))+Math.max(d,0))/n; al=((al*(n-1))+Math.max(-d,0))/n;}
  if(al===0) return 100;
  return 100-(100/(1+ag/al));
}
function atr(c,n=14){
  if(c.length<=n) return 0;
  let trs=[];
  for(let i=1;i<c.length;i++) trs.push(Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close)));
  return trs.slice(-n).reduce((a,b)=>a+b,0)/n;
}
function analyze(c){
  const closes=c.map(x=>x.close), last=closes.at(-1);
  const e9=ema(closes,9), e21=ema(closes,21), e50=ema(closes,50);
  const r=rsi(closes,14), fast=ema(closes,12), slow=ema(closes,26);
  const macd=fast!==null&&slow!==null?fast-slow:0;
  const sigBase=closes.slice(-35);
  const macdSeries=[];
  for(let i=26;i<=closes.length;i++){
    const part=closes.slice(0,i); macdSeries.push((ema(part,12)||0)-(ema(part,26)||0));
  }
  const macdSignal=ema(macdSeries,9)||0;
  const a=atr(c,14);
  const hi=Math.max(...c.slice(-50).map(x=>x.high)), lo=Math.min(...c.slice(-50).map(x=>x.low));
  let score=0, reasons=[];
  if(last>e9){score+=15;reasons.push("Price above EMA 9")}else{score-=15;reasons.push("Price below EMA 9")}
  if(e9>e21){score+=20;reasons.push("EMA 9 above EMA 21")}else{score-=20;reasons.push("EMA 9 below EMA 21")}
  if(e21>e50){score+=20;reasons.push("Medium trend bullish")}else{score-=20;reasons.push("Medium trend bearish")}
  if(r>55&&r<75){score+=15;reasons.push("RSI bullish")}else if(r<45&&r>25){score-=15;reasons.push("RSI bearish")}
  if(macd>macdSignal){score+=20;reasons.push("MACD bullish")}else{score-=20;reasons.push("MACD bearish")}
  const trend=score>=25?"BULLISH":score<=-25?"BEARISH":"NEUTRAL";
  const action=score>=45?"BUY":score<=-45?"SELL":"WAIT";
  const confidence=Math.min(95,Math.max(50,Math.round(50+Math.abs(score)*0.5)));
  return {price:last,rsi:r,ema9:e9,ema21:e21,ema50:e50,macd,macdSignal,atr:a,support:lo,resistance:hi,trend,action,confidence,reasons};
}

async function load(ws, req){
  const market=req.market||"forex", name=req.name||Object.keys(MARKETS[market])[0], tf=req.timeframe||"5m";
  const symbol=MARKETS[market]?.[name];
  if(!symbol) return send(ws,{type:"error",message:"Unknown market symbol"});
  try{
    send(ws,{type:"status",connected:true,provider:"public market data"});
    const candles=await yahoo(symbol,tf);
    const analysis=analyze(candles);
    send(ws,{type:"data",market,name,symbol,timeframe:tf,candles,analysis,updated:Date.now()});
  }catch(e){
    send(ws,{type:"error",message:e.message});
  }
}

wss.on("connection",(ws)=>{
  ws.on("message",async raw=>{
    try{
      const req=JSON.parse(raw.toString());
      if(req.type==="load") await load(ws,req);
      else if(req.type==="markets") send(ws,{type:"markets",markets:MARKETS});
    }catch(e){send(ws,{type:"error",message:"Invalid request"});}
  });
  send(ws,{type:"status",connected:true,provider:"public market data"});
});

setInterval(()=>wss.clients.forEach(ws=>{if(ws.readyState===WebSocket.OPEN) ws.ping();}),30000);
server.listen(PORT,"0.0.0.0",()=>console.log(`All-market analyzer running on ${PORT}`));
