const form = document.querySelector('#upload-form');
const fileInput = document.querySelector('#file');
const analysisPanel = document.querySelector('#analysis');
const resultPanel = document.querySelector('#result');
const message = document.querySelector('#message');
const optimizeButton = document.querySelector('#optimize');
let uploadId;

const formatBytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const formatDuration = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function showMessage(text) { message.textContent = text; }
function renderAnalysis(payload) {
  const { analysis, validation } = payload;
  document.querySelector('#filename').textContent = `${analysis.video.width} × ${analysis.video.height} source`; 
  document.querySelector('#validation-badge').textContent = validation.ready ? 'READY' : 'NEEDS OPTIMIZE';
  document.querySelector('#metrics').innerHTML = [['Duration', formatDuration(analysis.duration)], ['File size', formatBytes(analysis.fileSize)], ['Codec', analysis.video.codec.toUpperCase()], ['Frame rate', `${analysis.video.fps.toFixed(2)} FPS`]].map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join('');
  analysisPanel.classList.remove('hidden');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;
  const button = form.querySelector('button');
  button.disabled = true;
  showMessage('Uploading and probing media…');
  try {
    const data = new FormData();
    data.append('file', file);
    const uploadResponse = await fetch('/api/upload', { method: 'POST', body: data });
    const upload = await uploadResponse.json();
    if (!uploadResponse.ok) throw new Error(upload.error);
    uploadId = upload.id;
    const analysisResponse = await fetch('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: uploadId }) });
    const analysis = await analysisResponse.json();
    if (!analysisResponse.ok) throw new Error(analysis.error);
    renderAnalysis(analysis);
    showMessage('Analysis complete. Select quality and optimize.');
  } catch (error) { showMessage(error.message); } finally { button.disabled = false; }
});

optimizeButton.addEventListener('click', async () => {
  optimizeButton.disabled = true;
  showMessage('Encoding optimized delivery file…');
  try {
    const response = await fetch('/api/optimize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: uploadId, mode: document.querySelector('#mode').value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    document.querySelector('#result-copy').textContent = `${result.analysis.video.width} × ${result.analysis.video.height} · ${result.analysis.video.codec.toUpperCase()} · ${formatBytes(result.analysis.fileSize)}`;
    document.querySelector('#download').href = result.download;
    resultPanel.classList.remove('hidden');
    showMessage('Optimization complete.');
  } catch (error) { showMessage(error.message); } finally { optimizeButton.disabled = false; }
});
