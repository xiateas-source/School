(async function loadCatTrainerV4(){
  try {
    const packed=(window.__CT4||[]).join('');
    if(!packed) throw new Error('Cat Trainer art pack is empty.');
    const raw=atob(packed);
    const bytes=Uint8Array.from(raw,character=>character.charCodeAt(0));
    let source=await new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    ).text();

    const bridge=`
;(() => {
  const images=window.CAT_ASSET_IMAGES||{};
  for (const asset of Object.values(window.CAT_ASSETS||{})) {
    const match=/assets\/([^/.]+)\.webp$/.exec(asset.atlas||'');
    if (match && images[match[1]]) asset.atlas=images[match[1]];
  }
})();
`;
    const marker='\n\n(function(){const s=';
    if(!source.includes(marker)) throw new Error('Cat Trainer art bridge marker was not found.');
    source=source.replace(marker,bridge+'\n(function(){const s=');
    source=source.replace("background:url('assets/cafe-room.webp')","background:var(--cat-cafe-room)");

    (0,eval)(source);
    const roomImage=window.CAT_ASSET_IMAGES&&window.CAT_ASSET_IMAGES.room;
    if(roomImage) document.documentElement.style.setProperty('--cat-cafe-room',`url("${roomImage}")`);
    delete window.__CT4;
  } catch (error) {
    console.error('Cat Trainer v4 failed to load.',error);
    const toast=document.querySelector('#toast');
    if(toast){
      toast.textContent='The Cat Trainer artwork could not load. Please try again once online.';
      toast.classList.add('show');
    }
  }
})();
