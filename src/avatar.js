// Profile picture: crop to a centred square, shrink to 256 px JPEG in the browser, upload to the public 'avatars' bucket
// (my own folder only) and save the URL with the set_avatar function. Google sign-in photo is the fallback.
import { sb, state, rpc, loadMe } from './lib.js';

const SIZE = 256;
export const isCustomAvatar = () => !!state.avatar && state.avatar.includes('/storage/v1/object/public/avatars/');

async function toJpeg(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => { throw new Error('Could not read that image. Try a JPEG or PNG photo.'); });
  const s = Math.min(bmp.width, bmp.height), sx = (bmp.width - s) / 2, sy = (bmp.height - s) / 2;
  const c = document.createElement('canvas'); c.width = c.height = SIZE;
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.fillStyle = '#fff'; g.fillRect(0, 0, SIZE, SIZE);
  g.drawImage(bmp, sx, sy, s, s, 0, 0, SIZE, SIZE); bmp.close?.();
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not process that image'))), 'image/jpeg', 0.85));
}

// keep the folder tidy: delete my older pictures
async function dropOld(uid, keepPath) {
  try {
    const { data } = await sb.storage.from('avatars').list(uid, { limit: 100 });
    const old = (data || []).map((o) => `${uid}/${o.name}`).filter((p) => p !== keepPath);
    if (old.length) await sb.storage.from('avatars').remove(old);
  } catch { /* cleanup is best effort */ }
}

export async function changeAvatar(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Choose an image file');
  const uid = state.user.id, blob = await toJpeg(file), path = `${uid}/avatar-${Date.now()}.jpg`;
  const { error } = await sb.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
  if (error) throw new Error('Upload failed: ' + error.message);
  await rpc('set_avatar', { p_url: sb.storage.from('avatars').getPublicUrl(path).data.publicUrl });
  await dropOld(uid, path); await loadMe();
}

export async function removeAvatar() {
  await rpc('set_avatar', { p_url: null });
  await dropOld(state.user.id, null); await loadMe();
}
