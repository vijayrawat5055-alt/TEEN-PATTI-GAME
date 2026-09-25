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
const SUITS=["♠","♥","♦","♣"],RANKS=["2","3","4","5","6","7","8","9","10","J","Q","K","A"];

function deck(){return SUITS.flatMap(s=>RANKS.map(r=>({rank:r,suit:s})));}

function shuffle(a){for(let i=a.length-1;i;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function clientKey(s){return s.handshake.headers["x-forwarded-for"]?.split(",")[0]?.trim()||s.handshake.address;}
function newTable(){const id="table-"+Date.now()+"-"+Math.random().toString(36).slice(2,7);const t={id,players:new Map(),round:0,deck:[],turnIndex:0,phase:"waiting",cardNo:0,pot:0};tables.set(id,t);return t;}

function publicTable(t){
  const ps=[...t.players.values()];
  const current=ps[t.turnIndex];
  return {
    tableId:t.id,
    players:ps.map((p,i)=>({id:p.id,name:p.name,avatar:p.avatar||"",chips:p.chips,connected:p.connected,bet:p.bet,revealed:p.hand.length,turn:i===t.turnIndex})),
    pot:t.pot,round:t.round,phase:t.phase,cardNo:t.cardNo,
    currentPlayerId:current?.id||null
  };
}
function sendTable(t){
  io.to(t.id).emit("table:update",publicTable(t));
  t.players.forEach(p=>io.to(p.id).emit("hand",p.hand||[]));
}
function nextTurn(t){
  const ps=[...t.players.values()];
  if(!ps.length){t.phase="waiting";return;}
  t.turnIndex=(t.turnIndex+1)%ps.length;
  t.phase="draw";
  t.cardNo=0;
}
function startRound(t){
  t.deck=shuffle(deck());t.round++;t.pot=0;t.turnIndex=0;t.phase="draw";t.cardNo=0;
  t.players.forEach(p=>{p.hand=[];p.bet=0;p.round=t.round;});
  sendTable(t);
}

io.on("connection",s=>{
  const key=clientKey(s);

  s.on("player:join",(d,a)=>{
    for(const t of tables.values()){
      if(t.players.size<5 && ![...t.players.values()].some(p=>p.key===key&&p.connected)){
        const p={id:s.id,key,name:String(d?.name||"Player").slice(0,20),avatar:typeof d?.avatar==="string"&&d.avatar.length<1500000?d.avatar:"",chips:1000,connected:true,hand:[],bet:0,round:0};
        t.players.set(s.id,p);s.join(t.id);a?.({ok:true,tableId:t.id,tableNumber:t.id});sendTable(t);return;
      }
    }
    const t=newTable();
    const p={id:s.id,key,name:String(d?.name||"Player").slice(0,20),avatar:typeof d?.avatar==="string"&&d.avatar.length<1500000?d.avatar:"",chips:1000,connected:true,hand:[],bet:0,round:0};
    t.players.set(s.id,p);s.join(t.id);a?.({ok:true,tableId:t.id,tableNumber:t.id});sendTable(t);
  });

  s.on("round:start",(d,a)=>{
    const t=tables.get(d?.tableId);
    if(!t||!t.players.has(s.id))return a?.({ok:false,error:"Table not found"});
    if(t.players.size<2)return a?.({ok:false,error:"At least 2 players chahiye"});
    if(t.phase!=="waiting")return a?.({ok:false,error:"Round already running"});
    startRound(t);a?.({ok:true});
  });

  s.on("draw",(d,a)=>{
    const t=tables.get(d?.tableId),p=t?.players.get(s.id),ps=t?[...t.players.values()]:[];
    if(!p||!t||t.phase!=="draw"||ps[t.turnIndex]?.id!==s.id)return a?.({ok:false,error:"Abhi aapki turn nahi hai"});
    if(p.hand.length>=3)return a?.({ok:false,error:"Aapke 3 cards already hain"});
    const card=t.deck.pop();p.hand.push(card);t.cardNo=p.hand.length;t.phase="bet";
    sendTable(t);a?.({ok:true,card});
  });

  s.on("bet",(d,a)=>{
    const t=tables.get(d?.tableId),p=t?.players.get(s.id),ps=t?[...t.players.values()]:[],n=Math.floor(Number(d?.amount));
    if(!p||!t||t.phase!=="bet"||ps[t.turnIndex]?.id!==s.id)return a?.({ok:false,error:"Abhi aapki betting turn nahi hai"});
    if(!Number.isFinite(n)||n<1||n>p.chips)return a?.({ok:false,error:"Invalid bet"});
    p.chips-=n;p.bet+=n;t.pot+=n;
    if(p.hand.length>=3)nextTurn(t);else t.phase="draw";
    sendTable(t);a?.({ok:true});
  });

  s.on("disconnect",()=>{
    for(const t of tables.values()){
      const p=t.players.get(s.id);if(!p)continue;
      p.connected=false;sendTable(t);
      setTimeout(()=>{
        if(t.players.get(s.id)?.connected===false){
          const wasTurn=[...t.players.values()][t.turnIndex]?.id===s.id;
          t.players.delete(s.id);
          const ps=[...t.players.values()];
          if(!ps.length){tables.delete(t.id);return;}
          if(t.turnIndex>=ps.length)t.turnIndex=0;
          if(wasTurn)t.phase=t.phase==="waiting"?"waiting":"draw";
          sendTable(t);
        }
      },30000);break;
    }
  });
});

server.listen(PORT,()=>console.log("Teen Patti server on "+PORT));