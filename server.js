const express=require("express");
const http=require("http");
const {Server}=require("socket.io");
const app=express();
const server=http.createServer(app);
const io=new Server(server);
const PORT=process.env.PORT||3000;

app.set("trust proxy",true);
app.use(express.static("public"));
app.get("/health",(q,r)=>r.json({ok:true}));

const tables=new Map();
const S=["♠","♥","♦","♣"],R=["2","3","4","5","6","7","8","9","10","J","Q","K","A"];

function deck(){return S.flatMap(s=>R.map(r=>({rank:r,suit:s})));}
function shuffle(a){for(let i=a.length-1;i;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function clientKey(s){return s.handshake.headers["x-forwarded-for"]?.split(",")[0]?.trim()||s.handshake.address;}
function newTable(){const id="table-"+Date.now()+"-"+Math.random().toString(36).slice(2,7);const t={id,players:new Map(),round:0};tables.set(id,t);return t;}
function publicTable(t){return{tableId:t.id,players:[...t.players.values()].map(p=>({id:p.id,name:p.name,chips:p.chips,connected:p.connected})),pot:[...t.players.values()].reduce((n,p)=>n+p.bet,0),status:[...t.players.values()].some(p=>p.hand.length)?"playing":"waiting",round:t.round};}
function sendTable(t){io.to(t.id).emit("table:update",publicTable(t));t.players.forEach(p=>io.to(p.id).emit("hand",p.hand||[]));}
function startRound(t){let d=shuffle(deck());t.round++;t.players.forEach(p=>{p.hand=d.splice(0,3);p.bet=0;p.round=t.round;});sendTable(t);}

io.on("connection",s=>{
  const key=clientKey(s);

  s.on("player:join",(d,a)=>{
    for(const t of tables.values()){
      if(t.players.size<5 && ![...t.players.values()].some(p=>p.key===key&&p.connected)){
        const p={id:s.id,key,name:String(d?.name||"Player").slice(0,20),chips:1000,connected:true,hand:[],bet:0,round:0};
        t.players.set(s.id,p);
        s.join(t.id);
        a?.({ok:true,tableId:t.id,tableNumber:t.id});
        sendTable(t);
        return;
      }
    }
    const t=newTable();
    const p={id:s.id,key,name:String(d?.name||"Player").slice(0,20),chips:1000,connected:true,hand:[],bet:0,round:0};
    t.players.set(s.id,p);
    s.join(t.id);
    a?.({ok:true,tableId:t.id,tableNumber:t.id});
    sendTable(t);
  });

  s.on("round:start",(d,a)=>{
    const t=tables.get(d?.tableId);
    if(!t||!t.players.has(s.id))return a?.({ok:false,error:"Table not found"});
    if(t.players.size<2)return a?.({ok:false,error:"Need at least 2 players on this table"});
    if([...t.players.values()].some(p=>p.hand.length))return a?.({ok:false,error:"Round already running"});
    startRound(t);
    a?.({ok:true});
  });

  s.on("bet",(d,a)=>{
    const t=tables.get(d?.tableId),p=t?.players.get(s.id),n=Math.floor(Number(d?.amount));
    if(!p||!p.hand.length||!Number.isFinite(n)||n<1||n>p.chips)return a?.({ok:false,error:"Invalid bet"});
    p.chips-=n;p.bet+=n;sendTable(t);a?.({ok:true});
  });

  s.on("disconnect",()=>{
    for(const t of tables.values()){
      const p=t.players.get(s.id);
      if(!p)continue;
      p.connected=false;sendTable(t);
      setTimeout(()=>{
        if(t.players.get(s.id)?.connected===false)t.players.delete(s.id);
        if(t.players.size===0)tables.delete(t.id); else sendTable(t);
      },30000);
      break;
    }
  });
});

server.listen(PORT,()=>console.log("Teen Patti server on "+PORT));