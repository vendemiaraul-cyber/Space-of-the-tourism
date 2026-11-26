// Bootstrap. The Chromium.iso client and the sound engine load first and need no three.js;
// the 3D game is imported afterwards, so a CDN failure still leaves the Chromium panel usable.
import { Iso } from './iso.js';
import { Sound } from './audio.js';
import { isTouch, store } from './util.js';

const $ = (id) => document.getElementById(id);
document.body.classList.toggle('touch', isTouch);
$(isTouch ? 'ctlKeys' : 'ctlTouch').style.display = 'none';

const iso = new Iso();
const sound = new Sound();
sound.setMuted(store.get('muted', false));
window.__iso = iso;

// side menu remembers whether it was open
const setSide = (open) => { document.body.classList.toggle('side', open); store.set('side', open); };
$('cMenu').onclick = () => setSide(!document.body.classList.contains('side'));
$('sideX').onclick = () => setSide(false);
if (store.get('side', false) && !document.getElementById('title')) setSide(true);

// access key (needed to boot the VM)
$('keyInput').value = iso.key;
$('keySave').onclick = () => { iso.setKey($('keyInput').value); $('keySave').textContent = 'Saved'; setTimeout(() => ($('keySave').textContent = 'Save'), 1200); };
const keyBox = $('keyBox');
iso.hooks.needKey = () => { keyBox.classList.add('open'); $('keyBoxInput').value = iso.key; setTimeout(() => $('keyBoxInput').focus(), 50); };
$('keyBoxGo').onclick = () => { iso.setKey($('keyBoxInput').value); $('keyInput').value = iso.key; keyBox.classList.remove('open'); iso.open(); };
$('keyBoxX').onclick = () => keyBox.classList.remove('open');
$('keyBoxInput').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') $('keyBoxGo').click(); });

// until the 3D cockpit exists, the ISO chip opens the flat Chromium panel
let game = null;
$('isoChip').onclick = () => { if (game) return game.toggleIso(); iso.showPanel(true); iso.open(); };

import('./game.js')
  .then((m) => m.start({ iso, sound }))
  .then((g) => { game = g; })
  .catch((e) => {
    console.error(e);
    $('fatal').style.display = 'grid';
    $('fatalMsg').textContent = '3D could not start (' + (e && e.message ? e.message : e) + '). The Chromium.iso panel still works from the ISO button.';
    const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Open Chromium.iso'; b.style.marginTop = '16px';
    b.onclick = () => { $('fatal').style.display = 'none'; $('title').style.display = 'none'; iso.showPanel(true); iso.open(); };
    $('fatalMsg').after(b);
  });
