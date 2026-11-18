(() => {
  'use strict';

  const STORAGE_KEY = 'arah-companion-v1';
  const AI_ROUTE_KEY = 'arah-ai-route-v1';
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `arah-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const prettyDate = (value, options = { day:'numeric', month:'short', year:undefined }) => {
    if (!value) return 'Tanpa tenggat';
    const d = new Date(`${value}T00:00:00`);
    if (Number.isNaN(d.getTime())) return 'Tanpa tenggat';
    return new Intl.DateTimeFormat('id-ID', options).format(d);
  };
  const nowGreeting = () => {
    const h = new Date().getHours();
    return h < 11 ? 'Selamat pagi.' : h < 15 ? 'Selamat siang.' : h < 18 ? 'Selamat sore.' : 'Selamat malam.';
  };

  const defaultState = () => ({
    tasks: [], notes: [], habits: [],
    settings: { theme: false, largeText: false }
  });
  let state = loadState();
  let activePage = 'home';
  let taskFilter = 'all';
  let generatedPlan = null;
  let installPrompt = null;
  let aiMessages = [];
  let aiBusy = false;
  let aiPreferredRoute = localStorage.getItem(AI_ROUTE_KEY) === 'b' ? 'b' : 'a';

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return {
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
        habits: Array.isArray(parsed.habits) ? parsed.habits : [],
        settings: { ...defaultState().settings, ...(parsed.settings || {}) }
      };
    } catch (error) {
      console.warn('Data ARAH tidak dapat dibaca:', error);
      return defaultState();
    }
  }
  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      showToast('Penyimpanan browser penuh atau tidak tersedia. Ekspor data pentingmu.', 'error');
      return false;
    }
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const modalBackdrop = $('#modal-backdrop');
  const modalBody = $('#modal-body');

  function showToast(message, type = 'success') {
    const region = $('#toast-region');
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'error' : ''}`;
    toast.textContent = message;
    region.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3300);
  }

  function openModal(markup, focusSelector = 'input, textarea, button, select') {
    modalBody.innerHTML = markup;
    modalBackdrop.hidden = false;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => $(focusSelector, modalBody)?.focus(), 30);
  }
  function closeModal() {
    modalBackdrop.hidden = true;
    document.body.style.overflow = '';
    generatedPlan = null;
  }

  function navigate(page) {
    const allowed = ['home','ai','steps','notes','habits','guides','settings'];
    if (!allowed.includes(page)) return;
    activePage = page;
    $$('.page').forEach(el => el.classList.toggle('active', el.dataset.page === page));
    $$('[data-nav]').forEach(el => el.classList.toggle('active', el.dataset.nav === page));
    const labels = {home:'Beranda',ai:'Arah Cerdas',steps:'Langkah saya',notes:'Catatan',habits:'Rutinitas',guides:'Panduan praktis',settings:'Pengaturan'};
    $('#page-crumb').textContent = labels[page];
    window.scrollTo({ top:0, behavior: state.settings.reduceMotion ? 'auto' : 'smooth' });
    if (page === 'steps') renderTasks();
    if (page === 'notes') renderNotes();
    if (page === 'habits') renderHabits();
    if (page === 'ai') window.setTimeout(() => $('#ai-chat-input')?.focus(), 120);
  }

  function categoryLabel(category) {
    const labels = { umum:'Umum', belajar:'Belajar', kerja:'Pekerjaan', uang:'Keuangan', rumah:'Rumah', diri:'Diri sendiri', kreatif:'Kreatif' };
    return labels[category] || 'Umum';
  }

  function renderHeader() {
    $('#greeting').textContent = nowGreeting();
    const d = new Date();
    $('#today-label').textContent = new Intl.DateTimeFormat('id-ID',{weekday:'long'}).format(d).toUpperCase();
    $('#date-display').textContent = new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'long',year:'numeric'}).format(d);
    $('#habit-date').textContent = prettyDate(today(),{day:'numeric',month:'long'});
    $$('.year-now').forEach(el => el.textContent = String(d.getFullYear()));
  }

  function renderStats() {
    const active = state.tasks.filter(t => !t.done).length;
    const doneToday = state.tasks.filter(t => t.done && String(t.doneAt || '').slice(0,10) === today()).length;
    const doneHabits = state.habits.filter(h => (h.completions || []).includes(today())).length;
    $('#stat-active').textContent = active;
    $('#stat-done').textContent = doneToday;
    $('#stat-habits').textContent = `${doneHabits}/${state.habits.length}`;
    $('#side-step-count').textContent = active;
    $('#step-total').textContent = `${state.tasks.length} langkah`;
    $('#mobile-step-dot').classList.toggle('show', active > 0);
  }

  function renderNextStep() {
    const target = $('#next-step-content');
    const next = state.tasks.filter(t => !t.done).sort((a,b) => {
      if (a.due && b.due) return a.due.localeCompare(b.due);
      if (a.due) return -1;
      if (b.due) return 1;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    })[0];
    if (!next) {
      target.innerHTML = `<div class="empty-next"><p>Belum ada langkah yang menunggu. Buat satu hal kecil untuk memulai.</p><button data-action="plan">＋ Susun langkah</button></div>`;
      return;
    }
    const due = next.due ? `Tenggat ${escapeHTML(prettyDate(next.due,{day:'numeric',month:'short'}))}` : categoryLabel(next.category);
    target.innerHTML = `<div class="next-task"><button class="task-check" data-complete="${escapeHTML(next.id)}" aria-label="Tandai selesai">✓</button><div class="next-task-main"><b>${escapeHTML(next.title)}</b><small>${due}</small></div><span class="tiny-arrow">↗</span></div>`;
  }

  function renderTasks() {
    const host = $('#task-list');
    const items = state.tasks.filter(t => taskFilter === 'all' || (taskFilter === 'active' ? !t.done : t.done)).sort((a,b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.due && b.due) return a.due.localeCompare(b.due);
      if (a.due) return -1;
      if (b.due) return 1;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    $('#step-total').textContent = `${items.length} langkah`;
    if (!items.length) {
      const title = taskFilter === 'done' ? 'Belum ada yang selesai' : taskFilter === 'active' ? 'Semua langkah sudah beres' : 'Ruang langkahmu masih kosong';
      const body = taskFilter === 'done' ? 'Saat kamu menyelesaikan sesuatu, hasilnya akan tersimpan di sini.' : 'Mulai dari satu tujuan kecil. ARAH akan bantu memecahnya.';
      host.innerHTML = `<div class="empty-state"><div class="empty-symbol">◷</div><h3>${title}</h3><p>${body}</p>${taskFilter !== 'done' ? '<button data-action="plan">Buat peta langkah</button>' : ''}</div>`;
      return;
    }
    host.innerHTML = items.map(t => `
      <article class="task-item ${t.done ? 'is-done' : ''}">
        <button class="task-check ${t.done ? 'checked' : ''}" data-complete="${escapeHTML(t.id)}" aria-label="${t.done ? 'Batalkan selesai' : 'Tandai selesai'}">${t.done ? '✓' : ''}</button>
        <div class="task-text"><strong>${escapeHTML(t.title)}</strong><small>${t.due ? `Tenggat ${escapeHTML(prettyDate(t.due,{day:'numeric',month:'short',year:'numeric'}))}` : 'Tanpa tenggat'}${t.done && t.doneAt ? ` · Selesai ${escapeHTML(prettyDate(String(t.doneAt).slice(0,10),{day:'numeric',month:'short'}))}` : ''}</small></div>
        <div class="task-meta"><span class="task-tag">${escapeHTML(categoryLabel(t.category))}</span></div>
        <button class="more-button" data-edit-task="${escapeHTML(t.id)}" aria-label="Ubah langkah" title="Ubah">✎</button><button class="more-button" data-delete-task="${escapeHTML(t.id)}" aria-label="Hapus langkah" title="Hapus">×</button>
      </article>`).join('');
  }

  function renderNotes(query = '') {
    const host = $('#notes-grid');
    const q = query.trim().toLowerCase();
    const notes = [...state.notes].filter(n => !q || `${n.title} ${n.body}`.toLowerCase().includes(q)).sort((a,b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    if (!notes.length) {
      host.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-symbol">▤</div><h3>${q ? 'Catatan tidak ditemukan' : 'Belum ada catatan'}</h3><p>${q ? 'Coba kata kunci yang berbeda.' : 'Simpan ide, rencana, atau hal yang ingin kamu ingat.'}</p>${q ? '' : '<button data-action="note">Tulis catatan pertama</button>'}</div>`;
      return;
    }
    host.innerHTML = notes.map(n => `<article class="note-card"><button class="note-open" data-edit-note="${escapeHTML(n.id)}" style="border:0;background:transparent;padding:0;text-align:left;cursor:pointer"><h3>${escapeHTML(n.title || 'Catatan tanpa judul')}</h3><p>${escapeHTML(n.body)}</p></button><div class="note-card-foot"><span>${escapeHTML(prettyDate(String(n.updatedAt || n.createdAt || today()).slice(0,10),{day:'numeric',month:'short',year:'numeric'}))}</span><button data-delete-note="${escapeHTML(n.id)}">Hapus</button></div></article>`).join('');
  }

  function renderHabits() {
    const completed = state.habits.filter(h => (h.completions || []).includes(today())).length;
    const percent = state.habits.length ? Math.round(completed / state.habits.length * 100) : 0;
    const summary = $('#habit-summary');
    summary.innerHTML = `<div class="habit-progress-card"><div class="progress-ring" style="--progress:${percent}%"><strong>${percent}%</strong></div><div><h3>${completed} dari ${state.habits.length} rutinitas</h3><p>${state.habits.length ? (percent === 100 ? 'Semua yang kamu pilih sudah ditandai hari ini.' : 'Setiap centang adalah bentuk perhatian untuk dirimu.') : 'Tambahkan satu rutinitas yang ingin kamu rawat.'}</p></div></div><div class="habit-quote-card"><span>✦</span><p>Konsisten bukan berarti selalu sempurna. Kembali mencoba juga bagian dari proses.</p></div>`;
    const host = $('#habit-list');
    if (!state.habits.length) {
      host.innerHTML = `<div class="empty-state"><div class="empty-symbol">✳</div><h3>Belum ada rutinitas</h3><p>Pilih kebiasaan kecil yang realistis untuk keseharianmu.</p><button data-action="habit">＋ Tambah rutinitas</button></div>`;
      return;
    }
    host.innerHTML = state.habits.map(h => {
      const done = (h.completions || []).includes(today());
      const count = (h.completions || []).length;
      return `<article class="habit-item"><div class="habit-emoji">${escapeHTML(h.emoji || '✳')}</div><div class="habit-info"><strong>${escapeHTML(h.title)}</strong><small>${count} kali ditandai · ${done ? 'Sudah dilakukan hari ini' : 'Belum ditandai hari ini'}</small></div><button class="habit-done ${done ? 'completed' : ''}" data-toggle-habit="${escapeHTML(h.id)}">${done ? '✓ Selesai' : 'Tandai selesai'}</button><button class="more-button" data-delete-habit="${escapeHTML(h.id)}" aria-label="Hapus rutinitas">⋯</button></article>`;
    }).join('');
  }

  const guides = [
    {id:'mulai-kecil',icon:'🌱',color:'#e8f6ed',category:'KEBIASAAN',title:'Memulai kebiasaan tanpa terbebani',teaser:'Buat perubahan terasa cukup kecil untuk dimulai.',intro:'Kebiasaan baru lebih mudah dicoba ketika langkah pertamanya sederhana dan jelas. Fokuslah pada mengulang tindakan kecil, bukan mengejar hasil besar dalam satu hari.',steps:['Pilih satu kebiasaan yang memang penting bagimu.','Tentukan versi paling kecilnya, misalnya membaca satu halaman atau merapikan meja selama dua menit.','Tempelkan pada kegiatan yang sudah rutin kamu lakukan.','Siapkan alatnya sebelumnya agar lebih mudah memulai.','Tinjau setelah beberapa hari: apakah terlalu berat, terlalu mudah, atau sudah pas?'],closing:'Lewatkan satu hari bukan berarti semuanya gagal. Mulai kembali pada kesempatan berikutnya.'},
    {id:'atur-uang',icon:'🪙',color:'#fff3df',category:'KEUANGAN PRIBADI',title:'Melihat kondisi uang dengan lebih jernih',teaser:'Mulai dari catatan sederhana, bukan rumus rumit.',intro:'Langkah pertama mengelola uang adalah memahami alirannya. Panduan ini bersifat umum; sesuaikan dengan pendapatan, kebutuhan, dan tanggungan masing-masing.',steps:['Catat pemasukan yang benar-benar diterima.','Catat pengeluaran selama beberapa hari, termasuk nominal kecil.','Kelompokkan kebutuhan rutin, kebutuhan fleksibel, dan keinginan.','Tentukan satu pengeluaran yang bisa dikurangi tanpa mengganggu kebutuhan penting.','Sisihkan dana sesuai kemampuan dan prioritaskan kewajiban yang mendesak.'],closing:'Tidak ada satu pembagian anggaran yang cocok untuk semua orang. Kejelasan kondisi awal lebih penting daripada angka yang terlihat sempurna.'},
    {id:'fokus',icon:'⌛',color:'#eeeaff',category:'BELAJAR & KERJA',title:'Menyelesaikan pekerjaan saat pikiran penuh',teaser:'Kurangi beban memilih dengan menentukan satu prioritas.',intro:'Saat banyak hal menumpuk, otak perlu bantuan untuk melihat urutan. Coba cara sederhana ini sebelum mulai bekerja atau belajar.',steps:['Tuliskan semua hal yang sedang memenuhi pikiran.','Pilih satu hal yang paling penting atau memiliki tenggat terdekat.','Ubah menjadi tindakan yang bisa dilakukan dalam 10–25 menit.','Singkirkan gangguan yang tidak diperlukan selama waktu tersebut.','Setelah selesai, istirahat sebentar lalu tentukan langkah selanjutnya.'],closing:'Tidak semua hal harus selesai hari ini. Membuat prioritas membantu menjaga tenaga untuk hal yang benar-benar penting.'},
    {id:'lamaran',icon:'🧭',color:'#e8f5fa',category:'PERSIAPAN KERJA',title:'Menyiapkan diri sebelum melamar kerja',teaser:'Susun berkas dan persiapan secara bertahap.',intro:'Persiapan yang rapi membuat proses melamar lebih mudah dikelola. Persyaratan tiap perusahaan dan posisi bisa berbeda, jadi selalu baca pengumuman resminya.',steps:['Baca deskripsi posisi dan tandai keterampilan yang diminta.','Perbarui CV dengan pengalaman dan kemampuan yang relevan serta benar.','Siapkan portofolio atau contoh karya jika memang diminta.','Periksa kembali kontak, ejaan, format berkas, dan instruksi pengiriman.','Latih jawaban singkat tentang pengalaman, kemampuan, dan alasan melamar.'],closing:'Jangan mencantumkan pengalaman atau kemampuan yang tidak benar. Kejelasan dan kejujuran lebih berguna untuk proses jangka panjang.'},
    {id:'rapi',icon:'🧺',color:'#f9eaf1',category:'KEHIDUPAN SEHARI-HARI',title:'Merapikan ruang dalam waktu singkat',teaser:'Jangan mulai dari seluruh rumah. Pilih satu area.',intro:'Ruang yang lebih rapi bisa dimulai dari satu titik kecil. Tidak perlu menunggu waktu luang yang panjang.',steps:['Pilih satu area yang paling sering kamu gunakan.','Siapkan tempat untuk barang yang akan disimpan, dipindahkan, atau dibuang.','Atur timer 10–15 menit agar tugas punya batas yang jelas.','Kembalikan barang ke tempatnya dan bersihkan permukaan.','Tentukan satu kebiasaan kecil untuk menjaga area tersebut tetap rapi.'],closing:'Berhenti saat waktu selesai juga boleh. Kamu sudah membuat perubahan pada satu bagian ruangmu.'},
    {id:'keputusan',icon:'⚖️',color:'#f0edff',category:'PENGAMBILAN KEPUTUSAN',title:'Membandingkan dua pilihan dengan tenang',teaser:'Lihat kebutuhan, risiko, dan hal yang belum diketahui.',intro:'Ketika ragu memilih, tuliskan alasan yang mendukung dan hal yang perlu diwaspadai. Ini bukan mesin penentu keputusan, melainkan alat untuk membantu berpikir lebih jernih.',steps:['Tulis dua pilihan dengan kalimat yang spesifik.','Tuliskan manfaat nyata dari masing-masing pilihan.','Tuliskan biaya, risiko, dan hal yang perlu dikorbankan.','Tandai informasi penting yang belum kamu ketahui.','Tentukan kapan kamu akan meninjau informasi itu dan mengambil keputusan.'],closing:'Untuk keputusan besar terkait kesehatan, hukum, atau keuangan, pertimbangkan meminta bantuan profesional yang sesuai.'}
  ];

  function renderGuides() {
    $('#home-guides').innerHTML = guides.slice(0,3).map(g => `<button class="guide-mini" data-open-guide="${g.id}"><span class="guide-mini-icon" style="background:${g.color}">${g.icon}</span><strong>${escapeHTML(g.title)}</strong><small>${escapeHTML(g.teaser)}</small></button>`).join('');
    $('#guide-library').innerHTML = guides.map(g => `<button class="guide-card" data-open-guide="${g.id}"><span class="guide-card-icon" style="background:${g.color}">${g.icon}</span><span class="guide-card-content"><small>${escapeHTML(g.category)}</small><strong>${escapeHTML(g.title)}</strong><p>${escapeHTML(g.teaser)}</p></span><span class="guide-card-arrow">↗</span></button>`).join('');
  }

  function addTask(title, category = 'umum', due = '') {
    const clean = String(title || '').trim().slice(0,240);
    if (!clean) return false;
    state.tasks.unshift({ id:uid(), title:clean, category, due:due || '', done:false, createdAt:new Date().toISOString(), doneAt:null });
    persist();
    return true;
  }

  const planTemplates = [
    {key:'belajar',terms:['belajar','kursus','bahasa','sekolah','kuliah','ujian','pelajaran','skill','keterampilan','membaca'],category:'belajar',steps:['Tentukan satu kemampuan atau topik yang ingin dipelajari.','Pilih sumber belajar yang mudah diakses dan sesuai levelmu.','Bagi materi menjadi bagian kecil untuk beberapa sesi.','Jadwalkan sesi pertama selama 15–25 menit.','Catat satu hal yang sudah dipahami dan bagian yang masih membingungkan.']},
    {key:'kerja',terms:['kerja','pekerjaan','wawancara','interview','cv','lamar','lamaran','bisnis','usaha','klien','portofolio'],category:'kerja',steps:['Tentukan hasil yang ingin dicapai dan batas waktunya.','Kumpulkan informasi atau berkas yang dibutuhkan.','Kerjakan bagian paling penting terlebih dahulu.','Periksa hasilnya menggunakan daftar cek sederhana.','Tentukan tindak lanjut berikutnya dan kapan dilakukan.']},
    {key:'uang',terms:['uang','keuangan','menabung','tabungan','budget','anggaran','utang','pengeluaran','pemasukan','gaji'],category:'uang',steps:['Catat pemasukan dan pengeluaran yang kamu ketahui.','Pisahkan kebutuhan utama, kewajiban, dan keinginan.','Pilih satu bagian yang perlu diperhatikan lebih dulu.','Tentukan target kecil yang realistis sesuai kemampuan.','Tinjau catatan secara berkala dan sesuaikan bila keadaan berubah.']},
    {key:'rumah',terms:['rumah','kamar','bersih','rapi','beres','pindah','barang','dapur','lemari'],category:'rumah',steps:['Pilih satu area atau bagian yang ingin dibereskan.','Siapkan alat dan tempat untuk barang-barang.','Pisahkan barang yang disimpan, dipindah, atau tidak diperlukan.','Kerjakan area itu dalam satu sesi singkat.','Tentukan cara sederhana agar hasilnya lebih mudah dipertahankan.']},
    {key:'diri',terms:['sehat','olahraga','jalan kaki','tidur','stres','istirahat','minum air','makan','rutinitas','kebiasaan'],category:'diri',steps:['Pilih satu perubahan kecil yang aman dan sesuai keadaanmu.','Tentukan waktu atau pemicu yang mudah diingat.','Siapkan hal yang diperlukan sebelumnya.','Coba dalam skala ringan dan perhatikan bagaimana rasanya.','Evaluasi dan sesuaikan; cari saran ahli bila menyangkut kondisi kesehatan.']},
    {key:'kreatif',terms:['konten','video','desain','gambar','menulis','ide','karya','youtube','tiktok','edit'],category:'kreatif',steps:['Tentukan bentuk hasil akhir yang ingin dibuat.','Kumpulkan ide dan bahan yang sudah tersedia.','Buat kerangka atau sketsa kasar terlebih dahulu.','Selesaikan draf awal tanpa menuntut hasil sempurna.','Tinjau, rapikan, lalu tentukan langkah publikasi atau penyimpanan.']}
  ];
  function suggestPlan(goal) {
    const lower = goal.toLowerCase();
    const matched = planTemplates.find(t => t.terms.some(term => lower.includes(term)));
    const base = matched || {category:'umum',steps:['Jelaskan hasil akhir yang ingin kamu capai dengan satu kalimat.','Cari tahu apa yang sudah kamu miliki dan apa yang masih dibutuhkan.','Pilih tindakan paling kecil yang bisa dimulai hari ini.','Sisihkan waktu singkat untuk mengerjakannya tanpa menunggu sempurna.','Periksa kemajuan, lalu tentukan satu langkah berikutnya.']};
    return { category:base.category, steps:base.steps.map((s,i) => ({ id:uid(), title:s.replace(/^(Tentukan|Pilih|Catat|Jelaskan|Cari tahu|Kumpulkan|Pisahkan|Siapkan|Buat|Kerjakan|Selesaikan|Periksa|Tinjau|Jadwalkan|Bagi|Tentukan|Coba|Evaluasi|Sisihkan)/, m => m), order:i+1 })) };
  }

  function openPlanModal(prefill = '') {
    generatedPlan = null;
    openModal(`
      <p class="eyebrow">UBAH TUJUAN JADI TINDAKAN</p><h2 id="modal-title">Kita susun dari awal.</h2><p class="modal-intro">Tulis hasil yang ingin kamu capai. ARAH akan menawarkan kerangka langkah sederhana yang bisa kamu sesuaikan.</p>
      <form id="plan-form">
        <div class="form-field"><label for="plan-goal">Apa yang ingin kamu bereskan?</label><textarea id="plan-goal" maxlength="240" required placeholder="Contoh: Aku ingin menyiapkan portofolio untuk melamar kerja…">${escapeHTML(prefill)}</textarea></div>
        <div class="form-field"><label for="plan-category">Kategori (boleh diubah)</label><select id="plan-category"><option value="auto">Pilih otomatis</option><option value="umum">Umum</option><option value="belajar">Belajar</option><option value="kerja">Pekerjaan</option><option value="uang">Keuangan</option><option value="rumah">Rumah</option><option value="diri">Diri sendiri</option><option value="kreatif">Kreatif</option></select></div>
        <div id="plan-result-host"></div>
        <div class="modal-actions"><button type="button" class="ghost-button" data-close-modal>Batal</button><button class="modal-primary" type="submit">Susun langkah ↗</button></div>
      </form>`);
    $('#plan-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const goal = $('#plan-goal').value.trim();
      if (!goal) return;
      const suggested = suggestPlan(goal);
      const chosen = $('#plan-category').value;
      generatedPlan = { goal, category:chosen === 'auto' ? suggested.category : chosen, steps:suggested.steps };
      $('#plan-result-host').innerHTML = `<div class="plan-result"><h3>Rencana untuk: ${escapeHTML(goal)}</h3><ol>${generatedPlan.steps.map(s => `<li>${escapeHTML(s.title)}</li>`).join('')}</ol><p style="font-size:8px;color:#aaa5b3;margin:10px 0 0">Ini kerangka awal berbasis pola lokal, bukan jawaban AI. Kamu boleh mengedit setiap langkah setelah disimpan.</p><div class="plan-actions"><button type="button" class="modal-primary" id="save-generated-plan">Simpan semua langkah</button></div></div>`;
      $('#plan-category').value = generatedPlan.category;
      $('#save-generated-plan').addEventListener('click', () => {
        const chosenCategory = $('#plan-category').value;
        [...generatedPlan.steps].reverse().forEach((step, index, arr) => addTask(`${arr.length-index}. ${step.title}`, chosenCategory));
        const stamp = new Date().toISOString();
        state.notes.unshift({id:uid(),title:`Peta tujuan: ${generatedPlan.goal}`,body:`Tujuan yang ingin dicapai: ${generatedPlan.goal}\n\nLangkah yang disusun:\n${generatedPlan.steps.map((step,index)=>`${index+1}. ${step.title}`).join('\n')}\n\nKerangka ini dapat disesuaikan dengan kebutuhanmu.`,createdAt:stamp,updatedAt:stamp});
        persist();
        closeModal();
        renderAll();
        navigate('steps');
        showToast('Peta langkah disimpan. Silakan sesuaikan urutannya.');
      }, { once:true });
    });
  }

  function openNoteModal(note = null) {
    const editing = Boolean(note);
    openModal(`<p class="eyebrow">CATATAN PRIBADI</p><h2 id="modal-title">${editing ? 'Ubah catatan' : 'Simpan sesuatu.'}</h2><p class="modal-intro">Tulis ide atau hal penting dengan kata-katamu sendiri.</p>
      <form id="note-form"><div class="form-field"><label for="note-title">Judul</label><input id="note-title" maxlength="90" placeholder="Contoh: Ide yang ingin dicoba" value="${escapeHTML(note?.title || '')}"></div><div class="form-field"><label for="note-body">Isi catatan</label><textarea id="note-body" maxlength="5000" required placeholder="Tulis di sini…">${escapeHTML(note?.body || '')}</textarea></div><div class="modal-actions"><button type="button" class="ghost-button" data-close-modal>Batal</button><button type="submit" class="modal-primary">Simpan catatan</button></div></form>`);
    $('#note-form').addEventListener('submit', event => {
      event.preventDefault();
      const body = $('#note-body').value.trim();
      if (!body) { showToast('Isi catatan belum ditulis.', 'error'); return; }
      const stamp = new Date().toISOString();
      if (editing) {
        const target = state.notes.find(n => n.id === note.id);
        if (target) Object.assign(target,{title:$('#note-title').value.trim() || 'Catatan tanpa judul',body,updatedAt:stamp});
      } else {
        state.notes.unshift({id:uid(),title:$('#note-title').value.trim() || 'Catatan tanpa judul',body,createdAt:stamp,updatedAt:stamp});
      }
      persist(); closeModal(); renderAll(); navigate('notes'); showToast(editing ? 'Catatan diperbarui.' : 'Catatan disimpan.');
    });
  }

  function openHabitModal() {
    openModal(`<p class="eyebrow">RUTINITAS BARU</p><h2 id="modal-title">Kebiasaan apa yang ingin kamu rawat?</h2><p class="modal-intro">Pilih sesuatu yang sederhana dan realistis. Kamu bisa mengubahnya kapan saja.</p><form id="habit-form"><div class="form-field"><label for="habit-title">Nama rutinitas</label><input id="habit-title" maxlength="70" required placeholder="Contoh: Membaca 5 menit"></div><div class="form-row"><div class="form-field"><label for="habit-emoji">Ikon / emoji</label><input id="habit-emoji" maxlength="4" value="✳" placeholder="🌱"></div><div class="form-field"><label for="habit-frequency">Frekuensi</label><select id="habit-frequency"><option value="daily">Setiap hari</option><option value="flexible">Fleksibel</option></select></div></div><div class="modal-actions"><button type="button" class="ghost-button" data-close-modal>Batal</button><button type="submit" class="modal-primary">Simpan rutinitas</button></div></form>`);
    $('#habit-form').addEventListener('submit', event => {
      event.preventDefault();
      const title = $('#habit-title').value.trim();
      if (!title) return;
      state.habits.push({id:uid(),title,emoji:$('#habit-emoji').value.trim() || '✳',frequency:$('#habit-frequency').value,createdAt:new Date().toISOString(),completions:[]});
      persist(); closeModal(); renderAll(); navigate('habits'); showToast('Rutinitas baru ditambahkan.');
    });
  }

  function openTaskModal(task = null) {
    const editing = Boolean(task);
    openModal(`<p class="eyebrow">LANGKAH KECIL</p><h2 id="modal-title">${editing ? 'Ubah langkah' : 'Tambahkan langkah'}</h2><p class="modal-intro">Tulis tindakan yang jelas dan bisa dilakukan.</p><form id="task-form"><div class="form-field"><label for="task-title">Nama langkah</label><input id="task-title" required maxlength="240" value="${escapeHTML(task?.title || '')}" placeholder="Contoh: Kumpulkan contoh karya"></div><div class="form-row"><div class="form-field"><label for="task-category">Kategori</label><select id="task-category">${['umum','belajar','kerja','uang','rumah','diri','kreatif'].map(c=>`<option value="${c}" ${task?.category===c?'selected':''}>${categoryLabel(c)}</option>`).join('')}</select></div><div class="form-field"><label for="task-due">Tenggat (opsional)</label><input id="task-due" type="date" value="${escapeHTML(task?.due || '')}"></div></div><div class="modal-actions"><button type="button" class="ghost-button" data-close-modal>Batal</button><button type="submit" class="modal-primary">Simpan langkah</button></div></form>`);
    $('#task-form').addEventListener('submit', event => {
      event.preventDefault();
      const title = $('#task-title').value.trim();
      if (!title) return;
      if (editing) Object.assign(task,{title,category:$('#task-category').value,due:$('#task-due').value});
      else addTask(title,$('#task-category').value,$('#task-due').value);
      persist(); closeModal(); renderAll(); navigate('steps'); showToast(editing ? 'Langkah diperbarui.' : 'Langkah ditambahkan.');
    });
  }

  function openDecisionModal() {
    openModal(`<p class="eyebrow">RUANG UNTUK BERPIKIR</p><h2 id="modal-title">Bandingkan dua pilihan.</h2><p class="modal-intro">Tuliskan manfaat dan hal yang perlu dipertimbangkan. ARAH tidak memilihkan untukmu, tetapi membantu melihatnya lebih jelas.</p><form id="decision-form"><div class="form-field"><label for="decision-question">Keputusan yang sedang dihadapi</label><input id="decision-question" required maxlength="140" placeholder="Contoh: Memilih kelas A atau kelas B"></div><div class="decision-grid"><div class="decision-box"><h3>Pilihan A</h3><input class="form-field" id="choice-a" required maxlength="70" placeholder="Nama pilihan A"><textarea id="pros-a" placeholder="Kelebihan dan hal yang mendukung…"></textarea><textarea id="cons-a" placeholder="Risiko / hal yang perlu dicek…" style="margin-top:7px"></textarea></div><div class="decision-box"><h3>Pilihan B</h3><input class="form-field" id="choice-b" required maxlength="70" placeholder="Nama pilihan B"><textarea id="pros-b" placeholder="Kelebihan dan hal yang mendukung…"></textarea><textarea id="cons-b" placeholder="Risiko / hal yang perlu dicek…" style="margin-top:7px"></textarea></div></div><div class="form-field"><label for="decision-priority">Apa yang paling penting bagimu?</label><input id="decision-priority" maxlength="160" placeholder="Contoh: waktu, biaya, keamanan, kesempatan belajar"></div><div class="modal-actions"><button type="button" class="ghost-button" data-close-modal>Batal</button><button type="submit" class="modal-primary">Simpan perbandingan</button></div></form>`);
    $('#decision-form').addEventListener('submit', event => {
      event.preventDefault();
      const get = id => $(`#${id}`).value.trim();
      const question = get('decision-question');
      const note = `KEPUTUSAN: ${question}\n\nPILIHAN A — ${get('choice-a')}\nKelebihan: ${get('pros-a') || '-'}\nPerlu dipertimbangkan: ${get('cons-a') || '-'}\n\nPILIHAN B — ${get('choice-b')}\nKelebihan: ${get('pros-b') || '-'}\nPerlu dipertimbangkan: ${get('cons-b') || '-'}\n\nPrioritas utama: ${get('decision-priority') || 'Belum ditentukan'}\n\nLangkah berikutnya: cari informasi yang masih kurang, lalu putuskan berdasarkan kebutuhan dan keadaanmu.`;
      const stamp = new Date().toISOString();
      state.notes.unshift({id:uid(),title:`Perbandingan: ${question}`,body:note,createdAt:stamp,updatedAt:stamp});
      persist(); closeModal(); renderAll(); navigate('notes'); showToast('Perbandingan disimpan sebagai catatan.');
    });
  }

  function openGuide(id) {
    const guide = guides.find(g => g.id === id);
    if (!guide) return;
    openModal(`<div class="guide-detail"><p class="eyebrow">${escapeHTML(guide.category)}</p><h2 id="modal-title">${escapeHTML(guide.title)}</h2><p>${escapeHTML(guide.intro)}</p><h3>Langkah yang bisa dicoba</h3><ol>${guide.steps.map(s=>`<li>${escapeHTML(s)}</li>`).join('')}</ol><p><strong>Ingat:</strong> ${escapeHTML(guide.closing)}</p><div class="modal-actions"><button class="ghost-button" data-close-modal>Tutup</button><button class="modal-primary" id="save-guide-note">Simpan sebagai catatan</button></div></div>`);
    $('#save-guide-note').addEventListener('click', () => {
      const stamp = new Date().toISOString();
      state.notes.unshift({id:uid(),title:guide.title,body:`${guide.intro}\n\n${guide.steps.map((s,i)=>`${i+1}. ${s}`).join('\n')}\n\n${guide.closing}`,createdAt:stamp,updatedAt:stamp});
      persist(); closeModal(); renderAll(); navigate('notes'); showToast('Panduan disimpan ke catatan.');
    });
  }

  function toggleTask(id) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;
    task.done = !task.done;
    task.doneAt = task.done ? new Date().toISOString() : null;
    persist(); renderAll();
    showToast(task.done ? 'Satu langkah selesai. Bagus!' : 'Langkah dikembalikan ke daftar aktif.');
  }
  function toggleHabit(id) {
    const habit = state.habits.find(h => h.id === id);
    if (!habit) return;
    habit.completions = Array.isArray(habit.completions) ? habit.completions : [];
    habit.completions = habit.completions.includes(today()) ? habit.completions.filter(d => d !== today()) : [...habit.completions,today()];
    persist(); renderAll();
  }

  function renderAll() {
    renderHeader(); renderStats(); renderNextStep(); renderTasks(); renderNotes($('#note-search')?.value || ''); renderHabits(); renderGuides(); applySettings();
  }

  function applySettings() {
    document.body.classList.toggle('dark', Boolean(state.settings.theme));
    document.body.classList.toggle('large-text', Boolean(state.settings.largeText));
    $('#theme-toggle').setAttribute('aria-checked', String(Boolean(state.settings.theme)));
    $('#font-toggle').setAttribute('aria-checked', String(Boolean(state.settings.largeText)));
  }

  function openSearch() {
    $('#search-overlay').hidden = false;
    document.body.style.overflow = 'hidden';
    $('#global-search-input').value = '';
    renderSearch('');
    window.setTimeout(() => $('#global-search-input').focus(),30);
  }
  function closeSearch() {
    $('#search-overlay').hidden = true;
    document.body.style.overflow = '';
  }
  function renderSearch(query) {
    const host = $('#global-search-results');
    const q = query.trim().toLowerCase();
    const results = [];
    state.tasks.forEach(t => { if (!q || t.title.toLowerCase().includes(q)) results.push({type:'Langkah',icon:'◷',title:t.title,detail:t.done?'Selesai':'Belum selesai',page:'steps'}); });
    state.notes.forEach(n => { if (!q || `${n.title} ${n.body}`.toLowerCase().includes(q)) results.push({type:'Catatan',icon:'▤',title:n.title,detail:'Catatan pribadi',page:'notes'}); });
    guides.forEach(g => { if (!q || `${g.title} ${g.teaser} ${g.category}`.toLowerCase().includes(q)) results.push({type:'Panduan',icon:g.icon,title:g.title,detail:g.category,page:'guides',guide:g.id}); });
    const visible = q ? results.slice(0,12) : results.slice(0,6);
    host.innerHTML = visible.length ? visible.map((r,i) => `<button class="search-result" data-search-index="${i}"><span>${escapeHTML(r.icon)}</span><span><b>${escapeHTML(r.title)}</b><small>${escapeHTML(r.type)} · ${escapeHTML(r.detail)}</small></span></button>`).join('') : `<p style="font-size:10px;color:#aaa6b4;padding:8px">${q ? 'Tidak ada hasil yang cocok.' : 'Ketik kata kunci untuk mencari.'}</p>`;
    host._results = visible;
  }

  function exportData() {
    const payload = {app:'ARAH',version:1,exportedAt:new Date().toISOString(),data:state};
    const blob = new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `arah-cadangan-${today()}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    showToast('File cadangan sedang diunduh.');
  }
  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const data = parsed.data || parsed;
        if (!data || !Array.isArray(data.tasks) || !Array.isArray(data.notes) || !Array.isArray(data.habits)) throw new Error('Format tidak cocok');
        if (!window.confirm('Pulihkan cadangan? Data ARAH yang sekarang akan diganti dengan isi file.')) return;
        state = {tasks:data.tasks,notes:data.notes,habits:data.habits,settings:{...defaultState().settings,...(data.settings || {})}};
        persist(); renderAll(); navigate('home'); showToast('Cadangan berhasil dipulihkan.');
      } catch (error) { showToast('File tidak valid atau bukan cadangan ARAH.', 'error'); }
      $('#import-file').value = '';
    };
    reader.onerror = () => showToast('File tidak dapat dibaca.', 'error');
    reader.readAsText(file);
  }

  // Arah Cerdas chat. Provider credentials are never stored in this browser code.
  function appendAiMessage(role, content, options = {}) {
    const log = $('#ai-chat-log');
    const welcome = $('#ai-welcome');
    if (welcome) welcome.hidden = true;
    const row = document.createElement('div');
    row.className = `ai-message ${role}`;
    if (role === 'assistant') {
      const avatar = document.createElement('span');
      avatar.className = 'ai-message-avatar';
      avatar.textContent = '✧';
      row.appendChild(avatar);
    }
    const bubble = document.createElement('div');
    bubble.className = 'ai-message-bubble';
    bubble.textContent = content;
    if (options.pending) {
      bubble.classList.add('is-pending');
      bubble.setAttribute('aria-label', 'Arah Cerdas sedang menyiapkan jawaban');
      bubble.textContent = 'Arah Cerdas sedang berpikir…';
      row.dataset.pending = 'true';
    }
    row.appendChild(bubble);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    return row;
  }

  function setAiBusy(busy) {
    aiBusy = busy;
    $('#ai-send-button').disabled = busy;
    $('#ai-chat-input').disabled = busy;
    $('#ai-send-button').setAttribute('aria-busy', busy ? 'true' : 'false');
    $('#ai-status').classList.toggle('is-working', busy);
    $('#ai-status-text').textContent = busy ? 'Sedang menyiapkan jawaban' : 'Siap membantu';
  }

  async function sendAiMessage(text) {
    if (aiBusy) return;
    const message = String(text || '').trim();
    if (!message) return;
    aiMessages.push({ role: 'user', content: message });
    appendAiMessage('user', message);
    $('#ai-chat-input').value = '';
    $('#ai-chat-input').style.height = 'auto';
    const pending = appendAiMessage('assistant', '', { pending: true });
    setAiBusy(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch('/.netlify/functions/arah-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: aiMessages.slice(-12), preferredRoute: aiPreferredRoute }),
        signal: controller.signal
      });
      let payload = {};
      try { payload = await response.json(); } catch (_) { payload = {}; }
      if (!response.ok || !payload.reply) {
        throw new Error(payload.error || (response.status === 404 ? 'Layanan Arah Cerdas belum terpasang pada hosting ini.' : 'Arah Cerdas belum dapat menjawab. Coba lagi sebentar.'));
      }
      if (payload.nextRoute === 'a' || payload.nextRoute === 'b') {
        aiPreferredRoute = payload.nextRoute;
        try { localStorage.setItem(AI_ROUTE_KEY, aiPreferredRoute); } catch (_) {}
      }
      pending.remove();
      aiMessages.push({ role: 'assistant', content: payload.reply });
      appendAiMessage('assistant', payload.reply);
    } catch (error) {
      pending.remove();
      const message = error?.name === 'AbortError'
        ? 'Waktu tunggu habis. Periksa koneksi internet lalu coba lagi.'
        : (error?.message || 'Arah Cerdas sedang tidak terhubung. Coba lagi nanti.');
      appendAiMessage('assistant', message);
    } finally {
      window.clearTimeout(timeout);
      setAiBusy(false);
      $('#ai-chat-input').focus();
    }
  }

  $('#ai-chat-form').addEventListener('submit', event => {
    event.preventDefault();
    sendAiMessage($('#ai-chat-input').value);
  });
  $('#ai-chat-input').addEventListener('input', event => {
    const field = event.currentTarget;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 150)}px`;
  });
  $('#ai-chat-input').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      $('#ai-chat-form').requestSubmit();
    }
  });
  $('#ai-new-chat').addEventListener('click', () => {
    if (aiBusy) return;
    aiMessages = [];
    $('#ai-chat-log').innerHTML = '';
    const welcome = document.createElement('div');
    welcome.className = 'ai-welcome';
    welcome.id = 'ai-welcome';
    welcome.innerHTML = '<div class="ai-welcome-mark">✦</div><h2>Mulai percakapan baru.</h2><p>Apa yang ingin kamu pahami atau kerjakan hari ini?</p><div class="ai-suggestions"><button type="button" data-ai-prompt="Bantu aku membuat rencana belajar yang teratur dan realistis.">Buat rencana belajar</button><button type="button" data-ai-prompt="Jelaskan topik yang sulit dengan bahasa sederhana dan contoh.">Jelaskan topik sulit</button><button type="button" data-ai-prompt="Bantu aku menentukan prioritas dari beberapa pekerjaan yang menumpuk.">Atur prioritas</button></div>';
    $('#ai-chat-log').appendChild(welcome);
    $('#ai-chat-input').focus();
  });

  // Navigation and shared actions
  document.addEventListener('click', event => {
    const aiPrompt = event.target.closest('[data-ai-prompt]');
    if (aiPrompt) { sendAiMessage(aiPrompt.dataset.aiPrompt); return; }
    const nav = event.target.closest('[data-nav]');
    if (nav) { event.preventDefault(); navigate(nav.dataset.nav); return; }
    const action = event.target.closest('[data-action]');
    if (action) {
      const type = action.dataset.action;
      if (type === 'plan') openPlanModal();
      if (type === 'note') openNoteModal();
      if (type === 'habit') openHabitModal();
      if (type === 'decision') openDecisionModal();
      return;
    }
    if (event.target.closest('[data-close-modal]')) { closeModal(); return; }
    const complete = event.target.closest('[data-complete]');
    if (complete) { toggleTask(complete.dataset.complete); return; }
    const editTask = event.target.closest('[data-edit-task]');
    if (editTask) { const item = state.tasks.find(t => t.id === editTask.dataset.editTask); if (item) openTaskModal(item); return; }
    const delTask = event.target.closest('[data-delete-task]');
    if (delTask) {
      const item = state.tasks.find(t => t.id === delTask.dataset.deleteTask);
      if (item && window.confirm(`Hapus langkah “${item.title}”?`)) { state.tasks = state.tasks.filter(t=>t.id!==item.id); persist(); renderAll(); showToast('Langkah dihapus.'); }
      return;
    }
    const delNote = event.target.closest('[data-delete-note]');
    if (delNote) {
      if (window.confirm('Hapus catatan ini?')) { state.notes = state.notes.filter(n=>n.id!==delNote.dataset.deleteNote); persist(); renderAll(); showToast('Catatan dihapus.'); }
      return;
    }
    const editNote = event.target.closest('[data-edit-note]');
    if (editNote) { const note = state.notes.find(n=>n.id===editNote.dataset.editNote); if(note) openNoteModal(note); return; }
    const habitToggle = event.target.closest('[data-toggle-habit]');
    if (habitToggle) { toggleHabit(habitToggle.dataset.toggleHabit); return; }
    const delHabit = event.target.closest('[data-delete-habit]');
    if (delHabit) {
      const item = state.habits.find(h=>h.id===delHabit.dataset.deleteHabit);
      if (item && window.confirm(`Hapus rutinitas “${item.title}”?`)) { state.habits=state.habits.filter(h=>h.id!==item.id); persist(); renderAll(); showToast('Rutinitas dihapus.'); }
      return;
    }
    const guide = event.target.closest('[data-open-guide]');
    if (guide) { openGuide(guide.dataset.openGuide); return; }
    const example = event.target.closest('[data-example]');
    if (example) { $('#quick-capture').value = example.dataset.example; $('#quick-capture').focus(); return; }
    const searchResult = event.target.closest('[data-search-index]');
    if (searchResult) {
      const result = $('#global-search-results')._results?.[Number(searchResult.dataset.searchIndex)];
      if (result) { closeSearch(); navigate(result.page); if (result.guide) openGuide(result.guide); }
    }
  });

  $('#quick-capture-form').addEventListener('submit', event => {
    event.preventDefault();
    const value = $('#quick-capture').value.trim();
    if (!value) { showToast('Ceritakan dulu hal yang ingin kamu mulai.', 'error'); return; }
    openPlanModal(value);
    $('#quick-capture').value = '';
  });
  $('#step-filters').addEventListener('click', event => {
    const btn = event.target.closest('[data-filter]'); if (!btn) return;
    taskFilter = btn.dataset.filter;
    $$('.filter-tab').forEach(el=>el.classList.toggle('selected',el===btn));
    renderTasks();
  });
  $('#note-search').addEventListener('input', event => renderNotes(event.target.value));
  $('#search-open').addEventListener('click', openSearch);
  $('#profile-open').addEventListener('click', () => navigate('settings'));
  $('#search-close').addEventListener('click', closeSearch);
  $('#global-search-input').addEventListener('input', event => renderSearch(event.target.value));
  $('#modal-close').addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', event => { if (event.target === modalBackdrop) closeModal(); });
  $('#search-overlay').addEventListener('click', event => { if (event.target.id === 'search-overlay') closeSearch(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { if (!modalBackdrop.hidden) closeModal(); if (!$('#search-overlay').hidden) closeSearch(); } });

  $('#theme-toggle').addEventListener('click', () => { state.settings.theme = !state.settings.theme; persist(); applySettings(); });
  $('#font-toggle').addEventListener('click', () => { state.settings.largeText = !state.settings.largeText; persist(); applySettings(); });
  $('#export-data').addEventListener('click', exportData);
  $('#import-data').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', event => importData(event.target.files?.[0]));
  $('#clear-data').addEventListener('click', () => {
    if (!window.confirm('Yakin ingin menghapus semua langkah, catatan, dan rutinitas di perangkat ini? Tindakan ini tidak dapat dibatalkan. Ekspor cadangan terlebih dahulu bila masih diperlukan.')) return;
    state = defaultState(); persist(); renderAll(); navigate('home'); showToast('Data ARAH di perangkat ini telah dihapus.');
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event;
    if (!$('#install-app')) {
      const button = document.createElement('button'); button.id='install-app'; button.className='icon-button'; button.title='Pasang ARAH'; button.setAttribute('aria-label','Pasang ARAH'); button.textContent='＋';
      $('.top-actions').prepend(button);
      button.addEventListener('click', async () => {
        if (!installPrompt) return;
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null; button.remove();
      });
    }
  });
  window.addEventListener('appinstalled', () => { installPrompt=null; $('#install-app')?.remove(); showToast('ARAH berhasil dipasang.'); });

  renderAll();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker tidak terdaftar:',error)));
  }
})();
