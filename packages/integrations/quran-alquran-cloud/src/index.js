// Ayah of the day from AlQuran Cloud (https://alquran.cloud/api): Arabic (Uthmani), a
// translation and a recitation. The date picks the ayah, so every screen in the house shows the
// same one all day. Quran text always comes from here — never from an AI model.

import { defineIntegration, json, getJson } from '@noor-frame/core';

const TOTAL_AYAT = 6236;

export const TRANSLATIONS = [
  ['en.sahih', 'English', 'Saheeh International'], ['en.pickthall', 'English', 'Pickthall'], ['en.yusufali', 'English', 'Yusuf Ali'],
  ['en.hilali', 'English', 'Hilali & Khan'], ['en.asad', 'English', 'Muhammad Asad'], ['ur.jalandhry', 'اردو', 'Fateh Muhammad Jalandhry'],
  ['ur.junagarhi', 'اردو', 'Muhammad Junagarhi'], ['fr.hamidullah', 'Français', 'Muhammad Hamidullah'], ['tr.diyanet', 'Türkçe', 'Diyanet İşleri'],
  ['id.indonesian', 'Bahasa Indonesia', 'Kementerian Agama'], ['ms.basmeih', 'Bahasa Melayu', 'Abdullah Basmeih'], ['bn.bengali', 'বাংলা', 'Muhiuddin Khan'],
  ['de.bubenheim', 'Deutsch', 'Bubenheim & Elyas'], ['es.cortes', 'Español', 'Julio Cortés'], ['so.abduh', 'Soomaali', 'Mahmud Abduh'],
  ['sw.barwani', 'Kiswahili', 'Ali Muhsin Al-Barwani'], ['ru.kuliev', 'Русский', 'Elmir Kuliev'],
];
export const RECITERS = [
  ['ar.alafasy', 'Mishary Rashid Alafasy'], ['ar.husary', 'Mahmoud Khalil Al-Husary'], ['ar.abdurrahmaansudais', 'Abdurrahman As-Sudais'],
  ['ar.abdulbasitmurattal', 'Abdul Basit (Murattal)'], ['ar.mahermuaiqly', 'Maher Al-Muaiqly'], ['ar.minshawi', 'Mohamed Siddiq Al-Minshawi'],
  ['ar.saoodshuraym', 'Saud Ash-Shuraim'], ['ar.shaatree', 'Abu Bakr Ash-Shatri'], ['ar.ahmedajamy', 'Ahmed Al-Ajamy'], ['ar.hudhaify', 'Ali Al-Hudhaify'],
];

// Day number -> a well-mixed 32-bit value, so neighbouring days land far apart in the Quran.
export function dayHash(date) {
  let h = Math.floor(Date.parse(date + 'T00:00:00Z') / 864e5) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export async function ayahOfDay(ctx, date) {
  const q = await ctx.settings('quran');
  const { translation, reciter } = q;
  const maxArabic = q.maxArabicLength;
  return ctx.remember(`ayah-${date}-${translation}-${reciter}-${maxArabic}`, 24 * 3600e3, async () => {
    const h = dayHash(date);
    // Long ayat are skipped so the text fits the home tile; 2731 is prime, so retries jump around.
    for (let i = 0; i < 25; i++) {
      const n = ((h + i * 2731) % TOTAL_AYAT) + 1;
      const res = await getJson(`https://api.alquran.cloud/v1/ayah/${n}/editions/quran-uthmani,${translation},${reciter}`);
      const [ar, tr, au] = res.data || [];
      if (!ar || !tr) continue;
      if (ar.text.length > maxArabic && i < 24) continue;
      return {
        date, number: n, surah: ar.surah.number, ayah: ar.numberInSurah,
        surahName: ar.surah.englishName, surahMeaning: ar.surah.englishNameTranslation, surahAr: ar.surah.name,
        arabic: ar.text, translation: tr.text, translator: tr.edition.englishName,
        audio: au?.audio || null, audioAlt: au?.audioSecondary?.[0] || null, reciter: au?.edition?.englishName || null,
      };
    }
    throw new Error('No ayah found');
  });
}

export default defineIntegration({
  id: 'quran-alquran-cloud',
  name: 'Ayah of the day',
  description: 'A daily ayah in Arabic with a translation and recitation, from AlQuran Cloud.',
  section: 'quran',
  settings: [
    { key: 'translation', type: 'select', label: 'Translation', default: 'en.sahih', options: TRANSLATIONS.map(([value, language, label]) => ({ value, label, group: language })) },
    { key: 'reciter', type: 'select', label: 'Reciter', default: 'ar.alafasy', options: RECITERS.map(([value, label]) => ({ value, label })) },
    { key: 'maxArabicLength', type: 'number', label: 'Longest ayah to show (characters)', default: 220, min: 60, max: 2000, advanced: true },
  ],
  routes: {
    'GET /api/ayah': async (request, ctx) => {
      const date = new URL(request.url).searchParams.get('date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return json({ error: 'date=YYYY-MM-DD required' }, 400);
      const a = await ayahOfDay(ctx, date);
      // Screens play the recitation through this server (below), not straight from the CDN.
      return json({
        ...a,
        audio: a.audio && `/api/ayah/audio?date=${date}`,
        audioAlt: a.audioAlt && `/api/ayah/audio?date=${date}&alt=1`,
      }, 200, 3600);
    },
    // The recitation for a day's ayah. Older screens, like the Android 6 photo frame, can't verify
    // the CDN's https certificate, so the server fetches it for them. It only plays the day's own
    // ayah, so it can't be used to fetch anything else.
    'GET /api/ayah/audio': async (request, ctx) => {
      const params = new URL(request.url).searchParams;
      const date = params.get('date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return json({ error: 'date=YYYY-MM-DD required' }, 400);
      const a = await ayahOfDay(ctx, date);
      const src = params.get('alt') === '1' ? a.audioAlt : a.audio;
      if (!src) return json({ error: 'No recitation for this ayah' }, 404);
      const res = await fetch(src);
      if (!res.ok) return json({ error: `Recitation unavailable (${res.status})` }, 502);
      return new Response(await res.arrayBuffer(), {
        headers: { 'content-type': res.headers.get('content-type') || 'audio/mpeg', 'cache-control': 'public, max-age=86400' },
      });
    },
  },
  publicConfig: async (ctx) => {
    const q = await ctx.settings('quran');
    return { quran: { translation: q.translation, reciter: q.reciter } };
  },
  features: ['ayah'],
  tools: [{
    name: 'get_ayah_of_the_day',
    description: "Today's ayah as shown on the frame: exact Arabic text, translation and reference. Quote it exactly; never write Quran text yourself.",
    input_schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['date'] },
    run: async ({ date }, ctx) => {
      const a = await ayahOfDay(ctx, date);
      return { reference: `${a.surahName} ${a.surah}:${a.ayah}`, arabic: a.arabic, translation: a.translation, translator: a.translator };
    },
  }],
});
