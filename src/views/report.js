// Account > Report a problem: describe it, attach screenshots/files, submit (saved for the admin), then optionally ping the admin on WhatsApp.
import { sb, state, esc, toast, guard, rpc, needLogin, bindLogin } from '../lib.js';
import { waUrl } from '../receipt.js';

export const SUPPORT_WA = '6738626571';
export const CATEGORIES = { bug: 'Something is not working', deal: 'A problem with a deal (buyer or seller)', account: 'My account or sign-in', idea: 'Suggestion', other: 'Other' };
export const STATUS = { open: 'Open', working: 'Being looked at', resolved: 'Resolved' };
const MAX_FILES = 3, MAX_BYTES = 8 * 1024 * 1024, OK_TYPES = ['application/pdf', 'text/plain', 'text/csv', 'video/mp4', 'video/quicktime'];
const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const safeName = (n) => String(n || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(-60) || 'file';

export const waMessage = (id, cat, msg, nFiles, who) =>
  `Hi, I sent problem report #${id} on One Piece TCG.\nType: ${CATEGORIES[cat] || cat}\n${String(msg).replace(/\s+/g, ' ').slice(0, 300)}${String(msg).length > 300 ? '…' : ''}\n${nFiles ? `Attachments: ${nFiles} (you can open them in the Admin panel)\n` : ''}From: ${who}`;

// screenshots are shrunk in the browser (max 1600 px JPEG); other files are sent as they are
async function prepare(file) {
  if (file.type.startsWith('image/')) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
    if (!bmp) throw new Error(`Could not read ${file.name}`);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
    if (!blob) throw new Error(`Could not process ${file.name}`);
    return { blob, name: safeName(file.name.replace(/\.[^.]+$/, '') + '.jpg'), type: 'image/jpeg' };
  }
  if (!OK_TYPES.includes(file.type)) throw new Error(`${file.name}: this file type is not allowed. Use a screenshot, PDF, text file or MP4 video.`);
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is too big (max 8 MB)`);
  return { blob: file, name: safeName(file.name), type: file.type };
}

export async function viewReport($app) {
  if (!state.user) { $app.innerHTML = `<h1>Report a problem</h1>${needLogin('report a problem')}`; return bindLogin($app); }
  const uid = state.user.id, who = state.user.user_metadata?.full_name || state.me?.display_name || state.user.email;
  let picked = [];
  const { data: mine } = await sb.from('problem_reports').select('*').eq('reporter_id', uid).order('created_at', { ascending: false }).limit(20);
  $app.innerHTML = `<p><a href="#/account">← My account</a></p><h1>Report a problem</h1>
    <p class="muted">Tell us what went wrong. Add a screenshot if you can. The admin reads every report.</p>
    <div class="panel" id="form">
      <label for="rp-cat">What is it about?</label>
      <select id="rp-cat">${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      <label for="rp-msg">Describe the problem</label>
      <textarea id="rp-msg" rows="6" maxlength="2000" placeholder="What did you do, what did you expect, and what happened instead?"></textarea>
      <div class="muted" style="text-align:right"><span id="rp-n">0</span> / 2000</div>
      <label>Screenshots or files (optional, up to ${MAX_FILES})</label>
      <div class="row tight"><button class="btn sec" id="rp-add" type="button">📎 Add screenshot or file</button></div>
      <input type="file" id="rp-file" accept="image/*,application/pdf,text/plain,text/csv,video/mp4,video/quicktime" multiple hidden>
      <div id="rp-files"></div>
      <p class="muted">Screenshots are shrunk before upload. Files: PDF, text, CSV or MP4 up to 8 MB each. Your name and phone model are sent with the report so the admin can follow up.</p>
      <p><button class="btn" id="rp-go">Submit report</button></p>
    </div>
    <div id="done"></div>
    <h2 style="margin-top:1.2rem">My reports</h2>
    <div id="mine">${mine?.length ? mine.map((r) => mineRow(r, who)).join('') : '<p class="muted">You have not sent any reports yet.</p>'}</div>`;
  const $ = (s) => $app.querySelector(s);
  $('#rp-msg').oninput = (e) => ($('#rp-n').textContent = e.target.value.length);
  const drawFiles = () => {
    $('#rp-files').innerHTML = picked.map((p, i) => `<div class="row tight between" style="padding:.25rem 0"><span>${p.type.startsWith('image/') ? '🖼' : '📄'} ${esc(p.name)} <span class="muted">${fmtSize(p.blob.size)}</span></span><button class="btn sec sm-btn" data-rm="${i}" type="button">Remove</button></div>`).join('');
    $('#rp-files').querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { picked.splice(+b.dataset.rm, 1); drawFiles(); }));
    $('#rp-add').disabled = picked.length >= MAX_FILES;
  };
  $('#rp-add').onclick = () => $('#rp-file').click();
  $('#rp-file').onchange = guard(async () => {
    const files = [...$('#rp-file').files]; $('#rp-file').value = '';
    for (const f of files) { if (picked.length >= MAX_FILES) { toast(`Up to ${MAX_FILES} files only`, true); break; } picked.push(await prepare(f)); }
    drawFiles();
  });
  $('#rp-go').onclick = guard(async () => {
    const msg = $('#rp-msg').value.trim(), cat = $('#rp-cat').value;
    if (msg.length < 5) throw new Error('Please describe the problem (at least 5 characters)');
    const btn = $('#rp-go'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const files = [], stamp = Date.now();
      for (let i = 0; i < picked.length; i++) {
        const p = picked[i], path = `${uid}/${stamp}-${i}-${p.name}`;
        const { error } = await sb.storage.from('problem-files').upload(path, p.blob, { contentType: p.type });
        if (error) throw new Error('Upload failed: ' + error.message);
        files.push({ path, name: p.name, type: p.type, size: p.blob.size });
      }
      const device = `${navigator.userAgent} | ${screen.width}x${screen.height}`.slice(0, 300);
      const id = await rpc('submit_problem', { p_category: cat, p_message: msg, p_device: device, p_files: files });
      $('#form').style.display = 'none';
      $('#done').innerHTML = `<div class="panel"><div class="notice ok">✓ Report #${esc(id)} sent. Thank you.</div>
        <p>The admin can now see it, with your ${files.length ? 'attachments' : 'message'}. For something urgent you can also message the admin directly on WhatsApp.</p>
        <div class="row tight"><a class="btn" target="_blank" rel="noopener" href="${waUrl(SUPPORT_WA, waMessage(id, cat, msg, files.length, who))}">💬 Send on WhatsApp</a><a class="btn sec" href="#/report" id="again">Send another report</a></div></div>`;
      $('#again').onclick = (e) => { e.preventDefault(); viewReport($app); };
      const { data } = await sb.from('problem_reports').select('*').eq('reporter_id', uid).order('created_at', { ascending: false }).limit(20);
      $('#mine').innerHTML = (data || []).map((r) => mineRow(r, who)).join('');
      window.scrollTo(0, 0);
    } finally { btn.disabled = false; btn.textContent = 'Submit report'; }
  });
}

function mineRow(r, who) {
  const cls = r.status === 'resolved' ? 'ok' : r.status === 'working' ? 'warn' : '';
  return `<div class="order"><div class="grow"><div class="row tight between"><b>#${r.id} · ${esc(CATEGORIES[r.category] || r.category)}</b><span class="chip ${cls}">${esc(STATUS[r.status] || r.status)}</span></div>
    <div class="muted">${new Date(r.created_at).toLocaleString()}${r.files?.length ? ` · ${r.files.length} attachment${r.files.length > 1 ? 's' : ''}` : ''}</div>
    <div style="margin:.3rem 0;white-space:pre-wrap">${esc(r.message.length > 220 ? r.message.slice(0, 220) + '…' : r.message)}</div>
    ${r.admin_note ? `<div class="notice">Admin reply: ${esc(r.admin_note)}</div>` : ''}
    <a class="btn sec sm-btn" target="_blank" rel="noopener" href="${waUrl(SUPPORT_WA, waMessage(r.id, r.category, r.message, r.files?.length || 0, who))}">💬 Send on WhatsApp</a></div></div>`;
}
