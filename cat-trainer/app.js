'use strict';

(async function loadCatTrainerEmbeddedArt(){
  try {
    const packs=Array.from({length:21},(_,index)=>`v4-pack-${String(index+1).padStart(2,'0')}.js`);
    const sources=await Promise.all(packs.map(async file=>{
      const response=await fetch(file,{cache:'no-store'});
      if(!response.ok) throw new Error(`${file} returned ${response.status}`);
      return response.text();
    }));
    sources.forEach(source=>(0,eval)(source));

    const loaderResponse=await fetch('v4-loader.js',{cache:'no-store'});
    if(!loaderResponse.ok) throw new Error(`v4-loader.js returned ${loaderResponse.status}`);
    (0,eval)(await loaderResponse.text());
  } catch(error){
    console.error('Cat Trainer bootstrap failed.',error);
    const toast=document.querySelector('#toast');
    if(toast){
      toast.textContent='The Cat Trainer artwork could not load. Please try again once online.';
      toast.classList.add('show');
    }
  }
})();
