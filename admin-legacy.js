(function () {
"use strict";
var SUPABASE_URL="https://jjfxjfkomcjgmhjzhwmc.supabase.co";
var SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpqZnhqZmtvbWNqZ21oanpod21jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1NDI4MzYsImV4cCI6MjA5OTExODgzNn0.IDw7xJrgxvvi1_u-hI8lybsw5sMNSQN1lNUreCLUvb0";
var PRODUCTS=[["bandera", "La Bandera Dominicana"], ["moro-guandules-bandera", "Moro de Guandules (Bandera)"], ["moro-habichuelas-bandera", "Moro de Habichuelas (Bandera)"], ["mofongo", "Mofongo"], ["pescado-frito-entero", "Pescado Frito Entero"], ["chuleta-plancha", "Chuleta a la Plancha"], ["pica-pollo", "Pica Pollo"], ["alitas", "Alitas"], ["yaroa", "Yaroa"], ["fritura-combinada", "Fritura Combinada"], ["sancocho", "Sancocho"], ["tres-golpes", "Tres Golpes"], ["sandwich-tres-golpes", "Sandwis de 3 Golpes"], ["chimi", "Chimi"], ["tostada-dominicana", "Tostada Dominicana"], ["burritos", "Burritos"], ["quesadilla", "Quesadilla"], ["mini-bandera-kids", "Mini Bandera"], ["pica-pollo-kid", "Pica Pollo de Niño"], ["quesadilla-kids", "Quesadilla de Niño"], ["tostones-salami-kids", "Tostones con Salami"], ["chulitos-de-yuca", "Chulitos de Yuca"], ["quipes", "Quipes"], ["pastel-en-hoja", "Pastel en Hoja"], ["empanada-dominicana", "Empanada Dominicana"], ["jugo-guanabana", "Jugo Natural de Guanábana"], ["jugo-chinola", "Jugo Natural de Chinola"], ["jugo-tamarindo", "Jugo Natural de Tamarindo"], ["batida-zapote", "Batida de Zapote"], ["batida-de-lechosa", "Batida de Lechosa"]];
var INVENTORY=[
["inventory:1:pollo-guisar","Pollo guisar"],
["inventory:2:pollo-pica-pollo","Pollo pica pollo"],
["inventory:3:alitas","Alitas"],
["inventory:4:bistec","Bistec"],
["inventory:5:chuleta","Chuleta"],
["inventory:6:orejita","Orejita"],
["inventory:7:patica","Patica"],
["inventory:8:trompa","Trompa"],
["inventory:9:tilapia","Tilapia"],
["inventory:10:chillo","Chillo"],
["inventory:11:camarones","Camarones"],
["inventory:12:res","Res"],
["inventory:13:cerdo","Cerdo"],
["inventory:14:chicharron","Chicharron"],
["inventory:15:pechuga-de-pollo","Pechuga de Pollo"],
["inventory:16:salami","Salami"],
["inventory:17:bacon","Bacon"],
["inventory:18:longaniza","Longaniza"],
["inventory:19:pinguilin","Pinguilin"],
["inventory:20:rabito","Rabito"],
["inventory:21:platano-verde","Platano verde"],
["inventory:22:platano-maduro","Platano maduro"],
["inventory:23:pepino","Pepino"],
["inventory:24:tomate","Tomate"],
["inventory:25:lechuga","Lechuga"],
["inventory:26:repollo","Repollo"],
["inventory:27:papa","Papa"],
["inventory:28:papas-fritas","Papas fritas"],
["inventory:29:queso-mexicano","Queso mexicano"],
["inventory:30:queso-dominicano","Queso dominicano"],
["inventory:31:queso-rayado","Queso rayado"],
["inventory:32:arroz","Arroz"],
["inventory:33:habichuela","Habichuela"],
["inventory:34:gandules-con-coco","Gandules con coco"],
["inventory:35:guandules","Guandules"],
["inventory:36:yuca","Yuca"],
["inventory:37:ketchup","Ketchup"],
["inventory:38:mayonesa","Mayonesa"],
["inventory:39:yautia","Yautia"],
["inventory:40:envase-para-llevar-con-division","Envase para llevar con division"],
["inventory:41:envase-para-llevar-sin-division","Envase para llevar sin division"],
["inventory:42:jamon","Jamon"],
["inventory:43:huevo","Huevo"],
["inventory:44:tocino","Tocino"],
["inventory:45:cebolla","Cebolla"],
["inventory:46:pimientos","Pimientos"],
["inventory:47:chabola","Chabola"],
["inventory:48:tamarindo","Tamarindo"],
["inventory:49:guanabana","Guanabana"],
["inventory:50:aguacate","Aguacate"],
["inventory:51:bacalao","Bacalao"],
["inventory:52:limon","Limon"],
["inventory:53:zapatero","Zapatero"],
["inventory:54:lechoza","Lechoza"],
["inventory:55:envase-para-habichuela","Envase para Habichuela"],
["inventory:56:envase-de-mayo-kepchut","Envase de mayo-kepchut"],
["inventory:57:vaso-de-jugo","Vaso de jugo"],
["inventory:58:envase-de-nino","Envase de niño"],
["inventory:59:envase-de-set","Envase de set"],
["inventory:60:leche-condensada","Leche condensada"],
["inventory:61:leche-evaporada","Leche evaporada"],
["inventory:62:plato-de-plastico-para-comer","Plato de plastico para comer"],
["inventory:63:cucharas-desechables","Cucharas desechables"],
["inventory:64:envase-redondo","Envase redondo"],
["inventory:65:hielo","Hielo"],
["inventory:66:envase-de-sancocho","Envase de sancocho"],
["inventory:67:envase-para-salsa-pequeno","Envase para salsa pequeño"],
["inventory:68:envase-para-salsa-mediano","Envase para salsa mediano"],
["inventory:69:cafe-dominicano","Cafe dominicano"],
["inventory:70:guante","Guante"],
["inventory:71:servilleta","Servilleta"],
["inventory:72:sorvete","Sorvete"],
["inventory:73:vaso-para-cafe","Vaso para cafe"],
["inventory:74:sal","Sal"],
["inventory:75:azucar","Azucar"],
["inventory:76:vinagre","Vinagre"],
["inventory:77:sopita","Sopita"],
["inventory:78:aceite","Aceite"],
["inventory:79:aceite-de-oliva","Aceite de oliva"]
];
var ORDER_MODE_MANUAL_KEY="system:orders-manual";
var ORDER_MODE_OPEN_KEY="system:orders-open";
var availabilityMap={};

var PIN="5425";
var orders=[];
var hiddenKitchen={};
function byId(id){return document.getElementById(id);}
function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function money(v){var n=Number(v||0);return "$"+n.toFixed(2);}
function request(method,path,body,done){var xhr=new XMLHttpRequest();xhr.open(method,SUPABASE_URL+"/rest/v1/"+path,true);xhr.setRequestHeader("apikey",SUPABASE_KEY);xhr.setRequestHeader("Authorization","Bearer "+SUPABASE_KEY);xhr.setRequestHeader("Content-Type","application/json");xhr.setRequestHeader("Prefer","return=representation,resolution=merge-duplicates");xhr.onreadystatechange=function(){if(xhr.readyState!==4)return;if(xhr.status>=200&&xhr.status<300){var data=null;try{data=xhr.responseText?JSON.parse(xhr.responseText):null;}catch(e){}done(null,data);}else{done(new Error("Error "+xhr.status+": "+xhr.responseText));}};xhr.send(body?JSON.stringify(body):null);}

function functionRequest(name,body,done){
  var xhr=new XMLHttpRequest();
  xhr.open("POST",SUPABASE_URL+"/functions/v1/"+name,true);
  xhr.setRequestHeader("apikey",SUPABASE_KEY);
  xhr.setRequestHeader("Authorization","Bearer "+SUPABASE_KEY);
  xhr.setRequestHeader("Content-Type","application/json");
  xhr.onreadystatechange=function(){
    if(xhr.readyState!==4)return;
    var data=null;
    try{data=xhr.responseText?JSON.parse(xhr.responseText):null;}catch(e){}
    if(xhr.status>=200&&xhr.status<300)done(null,data);
    else done(new Error((data&&data.detail)||(data&&data.error)||("Error "+xhr.status+": "+xhr.responseText)));
  };
  xhr.send(JSON.stringify(body||{}));
}
function currentOrderMode(){
  var manual=availabilityMap[ORDER_MODE_MANUAL_KEY]===true;
  var open=availabilityMap[ORDER_MODE_OPEN_KEY]===true;
  return manual?(open?"open":"closed"):"auto";
}
function renderOrderMode(){
  var b=byId("orderModeBtn"),m=currentOrderMode();
  if(!b)return;
  b.className="secondary "+(m==="open"?"mode-open":m==="closed"?"mode-closed":"mode-auto");
  b.innerHTML=m==="open"?"Pedidos: ABIERTO":m==="closed"?"Pedidos: CERRADO":"Pedidos: AUTOMATICO";
}
function setOrderMode(mode){
  var manual=mode!=="auto",open=mode==="open",pending=2,failed=false;
  function done(err){if(err&&!failed){failed=true;alert(err.message);}pending--;if(pending===0){loadAvailability();}}
  setAvailability(ORDER_MODE_OPEN_KEY,open,done);
  setAvailability(ORDER_MODE_MANUAL_KEY,manual,done);
}
function cycleOrderMode(){
  var m=currentOrderMode();
  setOrderMode(m==="auto"?"open":m==="open"?"closed":"auto");
}
function orderType(o){var t=o.order_type||"";if(!t&&o.items&&o.items[0])t=o.items[0].orderType||"";return t==="dine-in"?"Para aquí":t==="takeout"?"Para llevar":"No indicado";}
function payment(o){return o.payment_method==="cash"?"Efectivo":o.payment_method==="card"?"Tarjeta":"No indicado";}
function status(o){return o.status==="ready"?"Listo":o.status==="accepted"?"Aceptado":"Nuevo";}
function normalize(row){return {id:String(row.public_id==null?row.id:row.public_id),databaseId:row.id,createdAt:row.created_at,customer:{name:row.customer_name||"",phone:row.customer_phone||""},items:row.items||[],totals:{total:row.total||0},paymentMethod:row.payment_method||"",orderType:row.order_type||"",status:row.status||"new",language:row.language||"es"};}
function itemHtml(item){var h='<div class="item"><strong>'+esc(item.quantity||1)+'x '+esc(item.nameEs||item.name||"")+'</strong>';var a=item.selections||[],i;for(i=0;i<a.length;i++)h+='<p>'+esc(a[i].groupEs||a[i].group)+': '+esc(a[i].nameEs||a[i].name)+'</p>';a=item.extras||[];for(i=0;i<a.length;i++)h+='<p>Extra: '+esc(a[i].nameEs||a[i].name)+'</p>';a=item.removables||[];for(i=0;i<a.length;i++)h+='<p>'+esc(typeof a[i]==="string"?a[i]:(a[i].nameEs||a[i].name))+'</p>';if(item.notes)h+='<p><strong>Nota:</strong> '+esc(item.notes)+'</p>';return h+'</div>';}
function render(){var h='',k='',i,j,o,cls;for(i=0;i<orders.length;i++){o=orders[i];cls=o.status==="ready"?" ready":o.status==="accepted"?" accepted":"";h+='<div class="order'+cls+'"><div class="row"><div class="left"><strong>Pedido '+esc(o.id)+'</strong><p>'+esc(new Date(o.createdAt).toLocaleString())+'</p></div><div class="right status">'+status(o)+'</div><div class="clear"></div></div><p><strong>'+esc(o.customer.name||"Sin nombre")+'</strong> · '+esc(o.customer.phone||"Sin teléfono")+'</p><p><strong>Tipo:</strong> '+orderType(o)+' · <strong>Pago:</strong> '+payment(o)+'</p>';for(j=0;j<o.items.length;j++)h+=itemHtml(o.items[j]);h+='<h2>Total '+money(o.totals.total)+'</h2>';if(o.status==="new")h+='<button data-action="accept" data-id="'+esc(o.id)+'">Aceptar</button>';if(o.status!=="ready")h+='<button class="secondary" data-action="ready" data-id="'+esc(o.id)+'">Marcar listo</button>';h+='<button class="danger" data-action="delete" data-id="'+esc(o.id)+'">Entregado / quitar</button></div>';if(!hiddenKitchen[o.id]){k+='<div class="order"><strong>Pedido '+esc(o.id)+'</strong>';for(j=0;j<o.items.length;j++)k+=itemHtml(o.items[j]);k+='<button class="secondary" data-action="hide" data-id="'+esc(o.id)+'">Terminado en cocina</button></div>';}}byId("ordersList").innerHTML=h||'<div class="card">No hay pedidos.</div>';byId("kitchenList").innerHTML=k||'<div class="card">No hay comandas.</div>';}
function loadOrders(){byId("connectionMessage").innerHTML="Actualizando…";request("GET","orders?select=*&order=created_at.desc",null,function(err,data){if(err){byId("connectionMessage").className="error";byId("connectionMessage").innerHTML=esc(err.message);return;}orders=[];var i;for(i=0;i<(data||[]).length;i++)orders.push(normalize(data[i]));byId("connectionMessage").className="ok";byId("connectionMessage").innerHTML="Conectado. Última actualización: "+new Date().toLocaleTimeString();render();});}
function findOrder(id){var i;for(i=0;i<orders.length;i++)if(String(orders[i].id)===String(id))return orders[i];return null;}
function changeStatus(id,next){
  var o=findOrder(id);
  if(!o)return;
  if(next==="ready"){
    functionRequest("rapid-action",{adminPin:PIN,orderId:o.databaseId,publicId:Number(o.id)},function(err,data){
      if(err){alert("No se pudo enviar el mensaje: "+err.message);loadOrders();return;}
      if(data&&data.sms&&data.sms.queued===false){
        alert("Pedido marcado como listo, pero el mensaje no entro en la cola: "+(data.sms.detail||data.sms.reason||"error"));
      }else{
        alert("Pedido marcado como listo y mensaje enviado a la cola.");
      }
      loadOrders();
    });
    return;
  }
  request("PATCH","orders?id=eq."+encodeURIComponent(o.databaseId),{status:next,updated_at:new Date().toISOString()},function(err){
    if(err)alert(err.message);
    loadOrders();
  });
}
function removeOrder(id){var o=findOrder(id);if(!o||!confirm("¿Quitar este pedido para todos?"))return;request("DELETE","orders?id=eq."+encodeURIComponent(o.databaseId),null,function(err){if(err)alert(err.message);loadOrders();});}
function renderAvailability(map){var h='',i,p,checked;for(i=0;i<PRODUCTS.length;i++){p=PRODUCTS[i];checked=map[p[0]]!==false;h+='<label class="availability"><input type="checkbox" data-product="'+esc(p[0])+'" '+(checked?'checked="checked"':'')+'> '+esc(p[1])+'</label>';}byId("availabilityList").innerHTML=h;}
function loadAvailability(){request("GET","product_availability?select=product_id,available",null,function(err,data){var map={},i;if(err){byId("availabilityList").innerHTML='<p class="error">'+esc(err.message)+'</p>';return;}for(i=0;i<(data||[]).length;i++)map[data[i].product_id]=data[i].available!==false;renderAvailability(map);});}
function setAvailability(id,available){request("POST","product_availability?on_conflict=product_id",{product_id:id,available:available,updated_at:new Date().toISOString()},function(err){if(err)alert(err.message);});}
function switchTab(name){var buttons=document.querySelectorAll('[data-tab]'),panels=document.querySelectorAll('.panel'),i;for(i=0;i<buttons.length;i++)buttons[i].className=buttons[i].getAttribute('data-tab')===name?'active':'';for(i=0;i<panels.length;i++)panels[i].className='panel'+(panels[i].id===name+'Panel'?' active':'');if(name==='availability')loadAvailability();}
byId("pinForm").onsubmit=function(e){if(e)e.preventDefault();if(byId("pinInput").value!==PIN){byId("pinError").style.display="block";return false;}byId("login").style.display="none";byId("admin").style.display="block";loadOrders();loadAvailability();setInterval(loadOrders,5000);return false;};
byId("refreshBtn").onclick=loadOrders;
byId("orderModeBtn").onclick=cycleOrderMode;
document.onclick=function(e){e=e||window.event;var t=e.target||e.srcElement,action,id,tab;while(t&&t!==document){action=t.getAttribute&&t.getAttribute("data-action");tab=t.getAttribute&&t.getAttribute("data-tab");if(action||tab)break;t=t.parentNode;}if(tab){switchTab(tab);return;}if(!action)return;id=t.getAttribute("data-id");if(action==="accept")changeStatus(id,"accepted");else if(action==="ready")changeStatus(id,"ready");else if(action==="delete")removeOrder(id);else if(action==="hide"){hiddenKitchen[id]=true;render();}};
document.onchange=function(e){e=e||window.event;var t=e.target||e.srcElement,id=t.getAttribute&&t.getAttribute("data-product");if(id)setAvailability(id,!!t.checked);};
})();
