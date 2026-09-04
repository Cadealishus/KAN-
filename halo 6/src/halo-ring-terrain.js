/* =====================================================================
   halo-ring-terrain.js — heightmapped floor for a KRI ring
   The ring floor is a cylinder: u runs around the circumference, v runs
   across the band.  KRI-01 is ~31,400 km around and 500 km wide, roughly
   63:1, so a 4:1 heightmap is tiled around the ring and cross-faded at the
   seam.  Terrain rises INWARD (toward the axis), because "up" on the inner
   surface points at the axis.
   ===================================================================== */
(function(global){
"use strict";

const HaloTerrain={
  maps:Object.create(null),

  /* ---- heightmap loading ---- */
  load(ring,url){
    const key=ring.id;
    if(this.maps[key]) return this.maps[key];
    const rec={ready:false,w:0,h:0,data:null,url:url};
    this.maps[key]=rec;
    if(typeof document==="undefined") return rec;
    const img=new Image();
    img.crossOrigin="anonymous";
    img.onload=()=>{
      try{
        /* downsample to keep the CPU copy small; collision only needs metres,
           not per-pixel fidelity */
        const W=Math.min(2048,img.width), H=Math.min(512,img.height);
        const c=document.createElement("canvas"); c.width=W; c.height=H;
        const g=c.getContext("2d",{willReadFrequently:true});
        g.drawImage(img,0,0,W,H);
        const px=g.getImageData(0,0,W,H).data;
        const f=new Float32Array(W*H);
        for(let i=0,p=0;i<f.length;i++,p+=4) f[i]=px[p]/255;   /* 8-bit is plenty for height */
        rec.w=W; rec.h=H; rec.data=f; rec.ready=true;
        rec.texture=new THREE.CanvasTexture(c);
        rec.texture.wrapS=THREE.RepeatWrapping;
        rec.texture.wrapT=THREE.ClampToEdgeWrapping;
        console.log("[Halo] terrain heightmap ready for "+key+" ("+W+"x"+H+")");
        if(rec.onready) rec.onready();
      }catch(e){ console.warn("[Halo] heightmap decode failed: "+e.message); }
    };
    img.onerror=()=>console.warn("[Halo] heightmap not found: "+url+" — using procedural relief");
    img.src=url;
    return rec;
  },

  /* how many times the map wraps around the circumference so pixels stay
     roughly square on the ground */
  tiles(ring,rec){
    const circumference=2*Math.PI*ring.radius;
    const aspectGround=circumference/ring.width;
    const aspectMap=(rec&&rec.w&&rec.h)?rec.w/rec.h:4;
    return Math.max(1,Math.round(aspectGround/aspectMap));
  },

  /* deterministic fallback so the ring is never flat if the map is missing */
  procedural(ring,u,v){
    const s=ring.terrainSeed||1;
    const h=(x,y)=>{ const n=Math.sin(x*127.1+y*311.7+s*13.7)*43758.5453; return n-Math.floor(n); };
    const vn=(x,y)=>{
      const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi;
      const a=h(xi,yi),b=h(xi+1,yi),c=h(xi,yi+1),d=h(xi+1,yi+1);
      const ux=xf*xf*(3-2*xf), uy=yf*yf*(3-2*yf);
      return (a+(b-a)*ux)+((c+(d-c)*ux)-(a+(b-a)*ux))*uy;
    };
    let f=1,amp=.5,sum=0;
    for(let o=0;o<5;o++){ sum+=amp*vn(u*24*f,v*6*f); f*=2.03; amp*=.5; }
    return sum;
  },

  /* Height in metres above the ring's datum floor.
     u = fraction around the ring [0,1)   v = fraction across the band [0,1] */
  heightAt(ring,u,v){
    const rec=this.maps[ring.id];
    const relief=ring.relief||6000;
    let hv;
    if(rec&&rec.ready){
      const tiles=this.tiles(ring,rec);
      let fu=(u*tiles)%1; if(fu<0) fu+=1;
      const fv=Math.max(0,Math.min(1,v));
      const x=fu*(rec.w-1), y=fv*(rec.h-1);
      const x0=Math.floor(x), y0=Math.floor(y);
      const x1=Math.min(rec.w-1,x0+1), y1=Math.min(rec.h-1,y0+1);
      const tx=x-x0, ty=y-y0;
      const a=rec.data[y0*rec.w+x0], b=rec.data[y0*rec.w+x1];
      const c=rec.data[y1*rec.w+x0], d=rec.data[y1*rec.w+x1];
      hv=(a+(b-a)*tx)+((c+(d-c)*tx)-(a+(b-a)*tx))*ty;
      /* cross-fade the tile seam so the wrap is not a cliff */
      const seam=0.02;
      if(fu<seam||fu>1-seam){
        const t=fu<seam?(fu/seam):((1-fu)/seam);
        const w=0.5-0.5*Math.cos(Math.PI*Math.max(0,Math.min(1,t)));
        const mirror=rec.data[Math.round(fv*(rec.h-1))*rec.w+(fu<seam?rec.w-1:0)];
        hv=hv*w+mirror*(1-w);
      }
    }else{
      hv=this.procedural(ring,u,v);
    }
    /* taper to zero at the band edges so terrain never pokes through the wall */
    const edge=Math.min(1,Math.min(v,1-v)/0.06);
    const taper=edge*edge*(3-2*edge);
    return hv*relief*taper;
  },

  /* ring-local coordinates -> (u,v) */
  uv(ring,L){
    const axis=L.axis;
    /* build a stable reference frame around the axis */
    let ref=ring._ref;
    if(!ref){
      ref=Math.abs(axis.y)>0.9?new THREE.Vector3(1,0,0):new THREE.Vector3(0,1,0);
      ref=new THREE.Vector3().crossVectors(axis,ref).normalize();
      ring._ref=ref;
    }
    const bi=new THREE.Vector3().crossVectors(axis,ref).normalize();
    const x=L.radialDir.dot(ref), y=L.radialDir.dot(bi);
    let ang=Math.atan2(y,x); if(ang<0) ang+=Math.PI*2;
    const u=ang/(Math.PI*2);
    const v=(L.axial+ring.width*0.5)/ring.width;
    return {u:u,v:v};
  },

  /* floor radius at this point: terrain rises toward the axis */
  floorRadiusAt(ring,L){
    const q=this.uv(ring,L);
    return ring.radius-this.heightAt(ring,q.u,q.v);
  }
};

global.HaloTerrain=HaloTerrain;
if(typeof module!=="undefined"&&module.exports) module.exports=HaloTerrain;
})(typeof window!=="undefined"?window:globalThis);
