const DB_NAME = 'promptVault';
const STORE_NAME = 'items';
const LEGACY_KEY = 'promptVaultItems';
const $ = (selector) => document.querySelector(selector);

let db;
let items = [];
let activeTag = '全部';
let mode = 'all';
let current = null;
let previewUrls = [];

const gallery = $('#gallery');
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&#34;'
}[char]));
const blobUrls = new WeakMap();
function imageSource(image) {
  if (typeof image === 'string') return image;
  if (!blobUrls.has(image)) blobUrls.set(image, URL.createObjectURL(image));
  return blobUrls.get(image);
}
const displayDate = (value = '') => String(value).replaceAll('-', '.');

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function storeRequest(modeName, operation) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, modeName);
    const request = operation(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const getAllItems = () => storeRequest('readonly', (store) => store.getAll());
const putItem = (item) => storeRequest('readwrite', (store) => store.put(item));
const removeItem = (id) => storeRequest('readwrite', (store) => store.delete(id));

async function migrateLegacyItems() {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return;
  try {
    const legacyItems = JSON.parse(raw);
    if (Array.isArray(legacyItems)) {
      for (const item of legacyItems) await putItem(item);
    }
    localStorage.removeItem(LEGACY_KEY);
  } catch (error) {
    console.warn('旧数据迁移失败', error);
  }
}

function tags() {
  return ['全部', ...new Set(items.map((item) => item.tag).filter(Boolean))];
}

function renderTags() {
  const tagList = tags();
  const colors = ['#db6548', '#66a17b', '#5d82b4', '#c99a43', '#8b70b7'];
  if (!tagList.includes(activeTag)) activeTag = '全部';
  $('#chips').innerHTML = tagList.map((tag) =>
    `<button class="chip ${tag === activeTag ? 'active' : ''}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`
  ).join('');
  $('#sideTags').innerHTML = tagList.slice(1).map((tag, index) =>
    `<button class="tag-nav" style="--dot:${colors[index % colors.length]}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`
  ).join('');
  document.querySelectorAll('[data-tag]').forEach((button) => {
    button.onclick = () => {
      activeTag = button.dataset.tag;
      renderTags();
      render();
      closeMobileMenu();
    };
  });
}

function getFilteredItems() {
  const query = $('#searchInput').value.trim().toLocaleLowerCase('zh-CN');
  let list = items.filter((item) => {
    const searchable = `${item.title} ${item.tag} ${item.prompt}`.toLocaleLowerCase('zh-CN');
    return (activeTag === '全部' || item.tag === activeTag) && (!query || searchable.includes(query));
  });
  if (mode === 'favorite') list = list.filter((item) => item.favorite);
  if (mode === 'recent') list = list.filter((item) => item.lastViewed).sort((a, b) => b.lastViewed - a.lastViewed);
  const sort = $('#sortSelect').value;
  if (mode !== 'recent') {
    list = [...list].sort((a, b) => {
      if (sort === 'images') return b.images.length - a.images.length;
      if (sort === 'title') return a.title.localeCompare(b.title, 'zh-CN');
      return String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date));
    });
  }
  return list;
}

function render() {
  const list = getFilteredItems();
  $('#allCount').textContent = items.length;
  $('#resultCount').textContent = list.length;
  gallery.innerHTML = list.map((item) => `<article class="card" data-id="${item.id}">
    <div class="cover">
      <img src="${item.images[0]}" alt="${escapeHtml(item.title)}">
      <button class="fav ${item.favorite ? 'active' : ''}" data-fav="${item.id}" aria-label="${item.favorite ? '取消收藏' : '收藏'}"><i data-lucide="heart"></i></button>
      <span class="image-count"><i data-lucide="images"></i>${item.images.length}</span>
    </div>
    <h2 class="card-title">${escapeHtml(item.title)}</h2>
    <div class="card-meta"><span class="mini-tag">${escapeHtml(item.tag)}</span><span>${escapeHtml(displayDate(item.date))}</span></div>
  </article>`).join('');
  $('#empty').style.display = list.length ? 'none' : 'block';
  $('#empty h2').textContent = items.length ? '没有匹配结果' : '还没有提示词';
  $('#empty p').textContent = items.length ? '试试其他关键词或标签' : '点击右上角“新建条目”开始上传';
  document.querySelectorAll('.card').forEach((card) => {
    card.onclick = (event) => {
      if (!event.target.closest('.fav')) openDetail(Number(card.dataset.id));
    };
  });
  document.querySelectorAll('[data-fav]').forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      toggleFavorite(Number(button.dataset.fav));
    };
  });
  lucide.createIcons();
}

async function toggleFavorite(id) {
  const item = items.find((entry) => entry.id === id);
  if (!item) return;
  item.favorite = !item.favorite;
  await putItem(item);
  if (current?.id === id) $('#favoriteBtn').classList.toggle('active', item.favorite);
  render();
}

async function openDetail(id) {
  current = items.find((item) => item.id === id);
  if (!current) return;
  current.lastViewed = Date.now();
  await putItem(current);
  $('#favoriteBtn').classList.toggle('active', Boolean(current.favorite));
  $('#detailContent').innerHTML = `<div class="detail-body">
    <h2 class="detail-title">${escapeHtml(current.title)}</h2>
    <div class="detail-date">创建于 ${escapeHtml(displayDate(current.date))} · NovelAI</div>
    <div class="detail-tags"><span class="detail-tag">${escapeHtml(current.tag)}</span><span class="detail-tag">${current.images.length} 张结果</span></div>
    <div class="section-label"><span>正向提示词</span><button class="copy-btn" data-copy="prompt"><i data-lucide="copy"></i>复制</button></div>
    <div class="prompt-box">${escapeHtml(current.prompt)}</div>
    <div class="section-label"><span>生成结果 · ${current.images.length}</span><button class="copy-btn delete-entry" id="deleteEntry"><i data-lucide="trash-2"></i>删除条目</button></div>
    <div class="result-grid">${current.images.map((image, index) => `<img src="${image}" alt="${escapeHtml(current.title)} 生成结果 ${index + 1}" data-image="${index}">`).join('')}</div>
  </div>`;
  $('#detail').classList.add('open');
  $('#detail').setAttribute('aria-hidden', 'false');
  $('#overlay').classList.add('open');
  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.onclick = () => copyText(current[button.dataset.copy] || '');
  });
  document.querySelectorAll('[data-image]').forEach((image) => {
    image.onclick = () => showImage(Number(image.dataset.image));
  });
  $('#deleteEntry').onclick = deleteCurrentEntry;
  lucide.createIcons();
}

function closeDetail() {
  $('#detail').classList.remove('open');
  $('#detail').setAttribute('aria-hidden', 'true');
  $('#overlay').classList.remove('open');
}

async function deleteCurrentEntry() {
  if (!current || !confirm(`确定删除“${current.title}”吗？此操作无法撤销。`)) return;
  const id = current.id;
  await removeItem(id);
  items = items.filter((item) => item.id !== id);
  current = null;
  closeDetail();
  renderTags();
  render();
  toast('条目已删除');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制到剪贴板');
  } catch {
    toast('复制失败，请手动选择文本');
  }
}

let toastTimer;
function toast(text) {
  clearTimeout(toastTimer);
  $('#toast span').textContent = text;
  $('#toast').classList.add('show');
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 2200);
}

function showImage(index) {
  $('#lightboxImg').src = imageSource(current.images[index]);
  $('#lightboxCount').textContent = `${index + 1} / ${current.images.length}`;
  $('#lightbox').showModal();
}

const fileToData = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

function revokePreviews() {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
}

function openEntry() {
  const form = $('#entryForm');
  form.reset();
  form.elements.date.value = new Date().toISOString().slice(0, 10);
  revokePreviews();
  $('#uploadPreview').innerHTML = '';
  requestAnimationFrame(() => $('#entryDialog').showModal());
}

function closeEntry() {
  revokePreviews();
  if ($('#entryDialog').open) $('#entryDialog').close();
}

function closeMobileMenu() {
  $('.sidebar').classList.remove('open');
}

$('#imageInput').onchange = (event) => {
  revokePreviews();
  previewUrls = [...event.target.files].map((file) => URL.createObjectURL(file));
  $('#uploadPreview').innerHTML = previewUrls.map((url, index) => `<img src="${url}" alt="待上传图片 ${index + 1}">`).join('');
};

$('#entryForm').onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const files = [...form.elements.images.files];
  if (!files.length) return;
  const submitButton = form.querySelector('[type="submit"]');
  submitButton.disabled = true;
  submitButton.innerHTML = '<i data-lucide="loader-circle"></i>正在保存';
  lucide.createIcons();
  try {
    const item = {
      id: Date.now(),
      title: form.elements.title.value.trim(),
      tag: form.elements.tag.value.trim() || '未分类',
      date: form.elements.date.value || new Date().toISOString().slice(0, 10),
      createdAt: Date.now(),
      prompt: form.elements.prompt.value.trim(),
      favorite: false,
      lastViewed: null,
      images: await Promise.all(files.map(fileToData))
    };
    await putItem(item);
    items.unshift(item);
    closeEntry();
    activeTag = '全部';
    renderTags();
    render();
    toast('条目已保存');
  } catch (error) {
    console.error(error);
    toast('保存失败，请检查浏览器存储空间');
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = '<i data-lucide="save"></i>保存条目';
    lucide.createIcons();
  }
};

$('#searchInput').oninput = render;
$('#sortSelect').onchange = render;
$('#closeDetail').onclick = closeDetail;
$('#overlay').onclick = closeDetail;
$('#favoriteBtn').onclick = () => current && toggleFavorite(current.id);
$('#lightbox .lightbox-close').onclick = () => $('#lightbox').close();
$('#themeToggle').onclick = () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('promptVaultTheme', document.body.classList.contains('dark') ? 'dark' : 'light');
};
$('.mobile-menu').onclick = () => $('.sidebar').classList.toggle('open');
document.querySelectorAll('.nav-item').forEach((button) => {
  button.onclick = () => {
    mode = button.dataset.filter;
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item === button));
    render();
    closeMobileMenu();
  };
});
$('#addButton').onclick = openEntry;
$('#closeEntry').onclick = closeEntry;
$('#cancelEntry').onclick = closeEntry;
$('#entryDialog').addEventListener('click', (event) => {
  if (event.target === $('#entryDialog')) closeEntry();
});
$('#entryDialog').addEventListener('cancel', (event) => {
  event.preventDefault();
  closeEntry();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if ($('#entryDialog').open) {
    event.preventDefault();
    closeEntry();
    return;
  }
  if ($('#detail').classList.contains('open')) closeDetail();
});

async function init() {
  try {
    if (localStorage.getItem('promptVaultTheme') === 'dark') document.body.classList.add('dark');
    db = await openDatabase();
    await migrateLegacyItems();
    items = await getAllItems();
    renderTags();
    render();
  } catch (error) {
    console.error(error);
    $('#empty').style.display = 'block';
    $('#empty h2').textContent = '无法打开本地存储';
    $('#empty p').textContent = '请确认浏览器允许此网站保存数据';
  }
  lucide.createIcons();
}

init();
