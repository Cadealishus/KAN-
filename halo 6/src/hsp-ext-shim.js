/* =====================================================================
   hsp-ext-shim.js — HSP extension hooks, installed from OUTSIDE the game.

   HSP does not ship a mod API yet (KAN 0.1 is visual-only), so this shim
   creates window.HSP_EXT by wrapping the two globals the base game already
   exposes:  window.hspGravityFull  and  flightScene.

   Nothing in HSP is edited.  Removing this file removes every hook.
   If a future HSP ships a real HSP_EXT, this shim stands aside.
   ===================================================================== */
(function(global){
"use strict";
if(global.HSP_EXT&&global.HSP_EXT.version>=1) return;   /* core provides it */

const EXT={
  version:1, viaShim:true,
  megastructures:[], gravityProviders:[], frameHooks:[], surfaceProviders:[], mods:{}
};
EXT.registerMod=function(meta){
  if(!meta||!meta.id) throw new Error("registerMod: meta.id required");
  EXT.mods[meta.id]={id:meta.id,name:meta.name||meta.id,version:meta.version||"0.0.0",
                     author:meta.author||"unknown",loaded:Date.now()};
  console.log("[HSP_EXT] mod registered: "+(meta.name||meta.id)+" "+(meta.version||""));
  return EXT.mods[meta.id];
};
EXT.registerMegastructure=function(d){ if(!d||!d.id) throw new Error("def.id required");
  EXT.megastructures.push(d); return d; };
EXT.registerGravityProvider=function(fn){ EXT.gravityProviders.push(fn); return fn; };
EXT.registerFrameHook=function(fn){ EXT.frameHooks.push(fn); return fn; };
EXT.registerSurfaceProvider=function(fn){ EXT.surfaceProviders.push(fn); return fn; };

EXT.applyGravity=function(acc,pos,t){
  for(let i=0;i<EXT.gravityProviders.length;i++){
    let a=null; try{ a=EXT.gravityProviders[i](pos,t); }catch(e){ a=null; }
    if(a) acc.add(a);
  }
  return acc;
};
/* Same signature as the core hook API, so a mod written against either works. */
EXT.runFrameHooks=function(ctx){
  for(let i=0;i<EXT.frameHooks.length;i++){
    try{ EXT.frameHooks[i](ctx); }catch(e){}
  }
};
EXT.surfaceFor=function(pos,t){
  for(let i=0;i<EXT.surfaceProviders.length;i++){
    let s=null; try{ s=EXT.surfaceProviders[i](pos,t); }catch(e){ s=null; }
    if(s) return s;
  }
  return null;
};

/* ---- hook 1: gravity, by wrapping the global the engine already calls ---- */
function installGravity(){
  if(typeof global.hspGravityFull!=="function") return false;
  if(global.hspGravityFull.__hspExtWrapped) return true;
  const base=global.hspGravityFull;
  const wrapped=function(pos,t){
    const acc=base(pos,t);
    return EXT.gravityProviders.length?EXT.applyGravity(acc,pos,t):acc;
  };
  wrapped.__hspExtWrapped=true;
  wrapped.__hspExtBase=base;
  global.hspGravityFull=wrapped;
  return true;
}
EXT.uninstall=function(){
  if(global.hspGravityFull&&global.hspGravityFull.__hspExtBase)
    global.hspGravityFull=global.hspGravityFull.__hspExtBase;
  EXT.gravityProviders.length=0; EXT.frameHooks.length=0;
  EXT.surfaceProviders.length=0; EXT.megastructures.length=0;
  console.log("[HSP_EXT] hooks removed; HSP restored to stock.");
};

/* ---- hook 2: per-frame callback riding the game's own scene ----
   HSP declares flightScene / flightState / flightCamera with `let` at top
   level.  A top-level let lives in the global LEXICAL environment and is NOT a
   property of window, so `global.flightScene` is undefined even though the bare
   name resolves.  Reading it the wrong way meant this loop bailed out every
   frame and nothing a mod registered was ever drawn. */
function lex(name){
  try{ return (0,eval)("typeof "+name+"!=='undefined' ? "+name+" : undefined"); }
  catch(e){ return undefined; }
}
function frameLoop(){
  global.requestAnimationFrame(frameLoop);
  if(!EXT.frameHooks.length) return;
  const scene=lex("flightScene")||global.flightScene||null;
  if(!scene) return;
  const fs=lex("flightState")||global.flightState||null;
  if(!fs||!fs.position) return;
  const originPos=fs.position, time=fs.time;
  EXT.runFrameHooks({scene:scene,camera:lex("flightCamera")||global.flightCamera||null,
                     originPos:originPos,time:time});
}

/* the engine module may load after this file, so keep trying briefly */
let tries=0;
(function waitForEngine(){
  if(installGravity()){
    console.log("[HSP_EXT] shim installed — gravity + frame hooks active (no HSP files modified).");
    global.requestAnimationFrame(frameLoop);
    return;
  }
  if(tries++<200) setTimeout(waitForEngine,100);
  else console.warn("[HSP_EXT] could not find window.hspGravityFull — gravity hook unavailable.");
})();

global.HSP_EXT=EXT;
})(typeof window!=="undefined"?window:globalThis);
