const statusEl = document.getElementById('status');
const deviceEl = document.getElementById('device');
const modelEl = document.getElementById('model');
const computeDeviceEl = document.getElementById('computeDevice');
const recordEl = document.getElementById('record');
const stopEl = document.getElementById('stop');
const copyEl = document.getElementById('copy');
const pasteEl = document.getElementById('paste');
const editEl = document.getElementById('edit');
const clearEl = document.getElementById('clear');
const refreshEl = document.getElementById('refresh');
const findMicEl = document.getElementById('findMic');
const settingsButtonEl = document.getElementById('settingsButton');
const developerButtonEl = document.getElementById('developerButton');
const startNewEl = document.getElementById('startNew');
const historyButtonEl = document.getElementById('historyButton');
const dictationViewEl = document.getElementById('dictationView');
const historyViewEl = document.getElementById('historyView');
const developerViewEl = document.getElementById('developerView');
const historyTextEl = document.getElementById('historyText');
const addModeEl = document.getElementById('addMode');
const transcriptEl = document.getElementById('transcript');
const progressTextEl = document.getElementById('progressText');
const timerEl = document.getElementById('timer');
const progressEl = document.getElementById('progress');
const levelFillEl = document.getElementById('levelFill');
const doneMarkEl = document.getElementById('doneMark');
const setupDialogEl = document.getElementById('setupDialog');
const setupAutoStartEl = document.getElementById('setupAutoStart');
const setupModelEl = document.getElementById('setupModel');
const finishSetupEl = document.getElementById('finishSetup');
const settingsDialogEl = document.getElementById('settingsDialog');
const startWithWindowsEl = document.getElementById('startWithWindows');
const useRecommendedButtonEl = document.getElementById('useRecommendedButton');
const openDeveloperEl = document.getElementById('openDeveloper');
const backToSettingsEl = document.getElementById('backToSettings');
const developerModeEl = document.getElementById('developerMode');
const developerCudaEl = document.getElementById('developerCuda');
const refreshGpuEl = document.getElementById('refreshGpu');
const gpuStatusEl = document.getElementById('gpuStatus');
const modelInfoEl = document.getElementById('modelInfo');
const orbEl = document.getElementById('orb');
const waveEls = Array.from(document.querySelectorAll('.wave'));
const waveBars = Array.from(document.querySelectorAll('.wave span'));

let settings = {};
let recording = false;
let editing = false;
let progressTimer = null;
let recordStartedAt = 0;
let operationStartedAt = 0;
let operationLabel = '';
let modelCatalog = [];

function setStatus(text) {
  statusEl.textContent = text;
}

function setRecording(value) {
  recording = value;
  recordEl.disabled = value;
  stopEl.disabled = !value;
  orbEl.classList.toggle('recording', value);
  if (!value) {
    setAudioVisualLevel(0);
  }
}

function setAudioVisualLevel(peak) {
  const normalized = Math.max(0, Math.min(1, peak * 260));
  orbEl.style.setProperty('--audio-scale', String(normalized));
  waveBars.forEach((bar, index) => {
    const offset = 0.72 + ((index % 4) * 0.12);
    bar.style.setProperty('--audio-scale', String(Math.min(1, normalized * offset)));
  });
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = String(Math.floor(total / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const secs = String(total % 60).padStart(2, '0');
  return `REC: ${hours}:${minutes}:${secs}`;
}

function setProgress(mode, text, value = 0) {
  progressTextEl.textContent = text;
  orbEl.classList.toggle('processing', mode === 'indeterminate' && !recording);
  if (mode === 'indeterminate') {
    progressEl.removeAttribute('value');
  } else {
    progressEl.value = value;
  }
}

function setDone(text) {
  doneMarkEl.textContent = text;
}

function updateDeveloperUi() {
  const developerMode = Boolean(settings.developerMode);
  developerButtonEl.classList.toggle('visible', developerMode);
  developerModeEl.checked = developerMode;
  developerCudaEl.checked = Boolean(settings.developerCudaEnabled);
  developerCudaEl.disabled = !developerMode;

  const cudaOption = computeDeviceEl.querySelector('option[value="cuda"]');
  if (cudaOption) {
    cudaOption.hidden = !developerMode || !settings.developerCudaEnabled;
  }
  if ((!developerMode || !settings.developerCudaEnabled) && computeDeviceEl.value === 'cuda') {
    computeDeviceEl.value = 'cpu';
  }
}

function startProgressLoop() {
  stopProgressLoop();
  progressTimer = setInterval(async () => {
    try {
      const status = await fetch('http://127.0.0.1:48731/status').then((r) => r.json());
      const elapsed = recording
        ? (Date.now() - recordStartedAt) / 1000
        : operationStartedAt
          ? (Date.now() - operationStartedAt) / 1000
          : Number(status.captured_seconds || 0);
      timerEl.textContent = `${elapsed.toFixed(1)}s`;
      if (recording) {
        timerEl.textContent = formatDuration(elapsed);
      }
      const peak = Number(status.level?.peak || 0);
      levelFillEl.style.width = `${Math.min(100, Math.round(peak * 600))}%`;
      setAudioVisualLevel(recording ? peak : 0);
      if (recording) {
        setProgress('determinate', 'Recording...', Math.min(100, elapsed % 100));
      } else if (status.status && status.status !== 'ready') {
        setProgress('indeterminate', status.status);
      } else if (operationLabel) {
        setProgress('indeterminate', operationLabel);
      }
    } catch {
      // Keep UI usable even if one poll fails.
    }
  }, 250);
}

function stopProgressLoop() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
}

function setEditing(value) {
  editing = value && transcriptEl.value.trim().length > 0;
  transcriptEl.readOnly = !editing;
  editEl.textContent = editing ? 'Lock' : 'Edit';
  editEl.disabled = transcriptEl.value.trim().length === 0;
  if (editing) {
    transcriptEl.focus();
  }
}

function appendTranscript(text) {
  const cleaned = (text || '').trim();
  if (!cleaned) return;
  setEditing(false);
  if (addModeEl.checked && transcriptEl.value.trim()) {
    transcriptEl.value = `${transcriptEl.value.trim()}\n${cleaned}`;
  } else {
    transcriptEl.value = cleaned;
  }
  setEditing(false);
  saveTranscriptHistory(cleaned);
}

function saveTranscriptHistory(text) {
  const key = 'synthetiqVoiceHistory';
  const existing = JSON.parse(localStorage.getItem(key) || '[]');
  existing.unshift({
    text,
    createdAt: new Date().toISOString()
  });
  localStorage.setItem(key, JSON.stringify(existing.slice(0, 25)));
}

function setView(viewName) {
  const historyActive = viewName === 'history';
  const developerActive = viewName === 'developer';
  dictationViewEl.classList.toggle('active', !historyActive && !developerActive);
  historyViewEl.classList.toggle('active', historyActive);
  developerViewEl.classList.toggle('active', developerActive);
  startNewEl.classList.toggle('active', !historyActive && !developerActive);
  historyButtonEl.classList.toggle('active', historyActive);
  settingsButtonEl.classList.toggle('active', false);
  developerButtonEl.classList.toggle('active', developerActive);
}

function showHistory() {
  const existing = JSON.parse(localStorage.getItem('synthetiqVoiceHistory') || '[]');
  if (!existing.length) {
    historyTextEl.value = '';
    setView('history');
    return;
  }
  historyTextEl.value = existing.map((entry, index) => {
    const stamp = new Date(entry.createdAt).toLocaleString();
    return `${index + 1}. ${stamp}\n${entry.text}`;
  }).join('\n\n------------------------------\n\n');
  setView('history');
}

async function saveSettings() {
  settings = await window.dictation.setSettings({
    selectedDeviceId: deviceEl.value || null,
    modelSize: modelEl.value,
    computeDevice: computeDeviceEl.value,
    addMode: addModeEl.checked,
    startWithWindows: Boolean(settings.startWithWindows),
    setupComplete: Boolean(settings.setupComplete),
    developerMode: Boolean(settings.developerMode),
    developerCudaEnabled: Boolean(settings.developerCudaEnabled)
  });
  await window.dictation.configure(settings);
  updateDeveloperUi();
}

function renderModelInfo(models) {
  modelCatalog = models;
  modelInfoEl.innerHTML = models.map((model) => {
    const status = model.active ? 'Active' : model.downloaded ? 'Downloaded' : 'Not downloaded';
    const action = model.active ? 'Using' : model.downloaded ? 'Use' : 'Download';
    const recommended = model.recommended ? '<span class="pill recommended">Recommended</span>' : '';
    return `
      <article class="model-card ${model.active ? 'active' : ''}">
        <div class="model-card-top">
          <div>
            <strong>${model.label}</strong>
            <span>${model.id}</span>
          </div>
          ${recommended}
        </div>
        <p>${model.notes}</p>
        <div class="model-meta">
          <span>${model.size}</span>
          <span>${model.speed}</span>
          <span>${status}</span>
        </div>
        <div class="model-card-actions">
          <button class="model-action" type="button" data-model="${model.id}" ${model.active ? 'disabled' : ''}>${action}</button>
          ${model.downloaded ? `<button class="model-delete" type="button" data-delete-model="${model.id}">Delete</button>` : ''}
        </div>
      </article>
    `;
  }).join('');
}

async function refreshGpuStatus() {
  gpuStatusEl.textContent = 'Checking GPU...';
  try {
    const status = await window.dictation.gpuStatus();
    if (!status.available) {
      gpuStatusEl.textContent = status.message || 'No NVIDIA GPU detected.';
      return;
    }
    gpuStatusEl.textContent = status.gpus
      .map((gpu) => `${gpu.name} - driver ${gpu.driver}, ${gpu.memory}`)
      .join('\n');
  } catch (error) {
    gpuStatusEl.textContent = `GPU check failed: ${error.message}`;
  }
}

async function refreshModels() {
  const modelResponse = await window.dictation.models();
  renderModelInfo(modelResponse.models || []);
}

async function loadDevices() {
  const response = await window.dictation.devices();
  deviceEl.innerHTML = '';
  for (const device of response.devices) {
    const option = document.createElement('option');
    option.value = String(device.id);
    const tags = [];
    if (device.default_input) tags.push('default');
    if (device.recommended) tags.push('recommended');
    option.textContent = tags.length ? `${device.name} (${tags.join(', ')})` : device.name;
    deviceEl.appendChild(option);
  }
  if (settings.selectedDeviceId) {
    deviceEl.value = String(settings.selectedDeviceId);
  } else if (response.recommended_input !== null && response.recommended_input !== undefined) {
    deviceEl.value = String(response.recommended_input);
  } else if (response.default_input !== null && response.default_input !== undefined) {
    deviceEl.value = String(response.default_input);
  }
}

async function boot() {
  try {
    settings = await window.dictation.getSettings();
    modelEl.value = settings.modelSize || 'small.en';
    computeDeviceEl.value = settings.computeDevice || 'cpu';
    addModeEl.checked = Boolean(settings.addMode);
    startWithWindowsEl.checked = Boolean(settings.startWithWindows);
    setupAutoStartEl.checked = Boolean(settings.startWithWindows);
    setupModelEl.value = settings.modelSize || 'small.en';
    updateDeveloperUi();

    let ready = false;
    for (let i = 0; i < 40; i += 1) {
      try {
        await window.dictation.health();
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (!ready) throw new Error('Worker did not start.');

    await loadDevices();
    try {
      await refreshModels();
    } catch {
      modelInfoEl.textContent = 'Model list unavailable until the worker is ready.';
    }
    await saveSettings();
    setStatus('Ready');
    if (!settings.setupComplete) {
      setupDialogEl.showModal();
    }
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
}

async function startRecording() {
  if (recording) return;
  try {
    await saveSettings();
    await window.dictation.startRecording({
      deviceId: deviceEl.value ? Number(deviceEl.value) : null
    });
    recordStartedAt = Date.now();
    setRecording(true);
    setDone('');
    timerEl.textContent = formatDuration(0);
    setProgress('determinate', 'Recording...', 0);
    startProgressLoop();
    setStatus('Recording...');
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
}

async function stopRecording() {
  if (!recording) return;
  try {
    setRecording(false);
    setProgress('indeterminate', 'Transcribing...');
    setStatus('Transcribing... first run may download/load the local model.');
    const response = await window.dictation.stopRecording();
    appendTranscript(response.text);
    if (response.text) {
      setProgress('determinate', 'Complete', 100);
      setDone('Done');
      timerEl.textContent = formatDuration(response.duration || 0);
      setStatus(`Ready. Audio level peak ${Number(response.peak || 0).toFixed(3)}.`);
    } else {
      setProgress('determinate', 'No text', 100);
      setDone('No text');
      timerEl.textContent = formatDuration(response.duration || 0);
      setStatus(response.reason || `No speech detected. Peak ${Number(response.peak || 0).toFixed(3)}.`);
    }
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    setRecording(false);
    setTimeout(stopProgressLoop, 1200);
  }
}

recordEl.addEventListener('click', startRecording);
stopEl.addEventListener('click', stopRecording);
copyEl.addEventListener('click', async () => {
  await window.dictation.copy(transcriptEl.value);
  setStatus('Copied');
});
pasteEl.addEventListener('click', async () => {
  await window.dictation.paste(transcriptEl.value);
  setStatus('Pasted');
});
clearEl.addEventListener('click', () => {
  transcriptEl.value = '';
  setEditing(false);
  setProgress('determinate', 'Idle', 0);
  setDone('');
  timerEl.textContent = formatDuration(0);
  levelFillEl.style.width = '0%';
  setStatus('Ready');
});
startNewEl.addEventListener('click', () => {
  setView('dictation');
  transcriptEl.value = '';
  addModeEl.checked = false;
  setEditing(false);
  setProgress('determinate', 'Idle', 0);
  setDone('');
  timerEl.textContent = formatDuration(0);
  setStatus('Ready for a new transcription');
});
historyButtonEl.addEventListener('click', showHistory);
editEl.addEventListener('click', () => {
  setEditing(!editing);
});
refreshEl.addEventListener('click', async () => {
  await loadDevices();
  setStatus('Devices refreshed');
});
findMicEl.addEventListener('click', async () => {
  try {
    setProgress('indeterminate', 'Testing microphones...');
    setStatus('Speak now. Testing each microphone input...');
    const levels = await window.dictation.deviceLevels();
    if (levels.best) {
      deviceEl.value = String(levels.best.id);
      await saveSettings();
      setProgress('determinate', 'Mic selected', 100);
      setStatus(`Selected ${levels.best.name}. Peak ${Number(levels.best.peak || 0).toFixed(4)}.`);
    } else {
      setStatus('No microphone inputs found.');
    }
  } catch (error) {
    setStatus(`Mic test failed: ${error.message}`);
  }
});
settingsButtonEl.addEventListener('click', async () => {
  settings = await window.dictation.getSettings();
  startWithWindowsEl.checked = Boolean(settings.startWithWindows);
  try {
    await refreshModels();
  } catch {
    modelInfoEl.textContent = 'Model list unavailable until the worker is ready.';
  }
  startNewEl.classList.remove('active');
  historyButtonEl.classList.remove('active');
  settingsButtonEl.classList.add('active');
  developerButtonEl.classList.remove('active');
  settingsDialogEl.showModal();
});
finishSetupEl.addEventListener('click', async (event) => {
  event.preventDefault();
  try {
    modelEl.value = setupModelEl.value;
    settings = await window.dictation.setSettings({
      ...settings,
      modelSize: setupModelEl.value,
      computeDevice: 'cpu',
      computeType: 'int8',
      developerMode: false,
      developerCudaEnabled: false,
      setupComplete: true
    });
    await window.dictation.setStartup(setupAutoStartEl.checked);
    settings = await window.dictation.getSettings();
    await saveSettings();
    setupDialogEl.close();
    setStatus('Setup complete');
  } catch (error) {
    setStatus(`Setup failed: ${error.message}`);
  }
});
startWithWindowsEl.addEventListener('change', async () => {
  const result = await window.dictation.setStartup(startWithWindowsEl.checked);
  settings = await window.dictation.getSettings();
  startWithWindowsEl.checked = Boolean(result.enabled);
  setStatus(result.ok ? 'Startup setting updated' : 'Could not update startup setting');
});
async function activateModel(modelId) {
  try {
    const selected = modelId;
    const model = modelCatalog.find((item) => item.id === selected);
    if (model?.active) {
      setStatus(`${model.label} is already active.`);
      return;
    }

    modelEl.value = selected;
    await saveSettings();

    if (model?.downloaded) {
      await refreshModels();
      setProgress('determinate', 'Model selected', 100);
      setStatus(`Using ${model.label}.`);
      return;
    }

    const heavy = ['medium.en', 'distil-large-v3', 'large-v3-turbo'].includes(selected);
    if (heavy) {
      setStatus(`${selected} is a large model. First download can take several minutes. Small English is recommended for speed.`);
    }
    operationStartedAt = Date.now();
    operationLabel = `Downloading/loading ${selected}...`;
    startProgressLoop();
    setProgress('indeterminate', `Downloading ${selected}...`);
    setStatus(`Downloading/loading ${selected}. This may take a few minutes the first time.`);
    const result = await window.dictation.downloadModel({
      modelSize: selected,
      computeDevice: computeDeviceEl.value || 'cpu',
      computeType: computeDeviceEl.value === 'cuda' ? 'float16' : 'int8'
    });
    await saveSettings();
    await refreshModels();
    setProgress('determinate', 'Model ready', 100);
    setStatus(`Model ready in ${Number(result.seconds || 0).toFixed(1)}s`);
  } catch (error) {
    setStatus(`Model download failed: ${error.message}`);
  } finally {
    operationStartedAt = 0;
    operationLabel = '';
    setTimeout(stopProgressLoop, 1200);
  }
}

modelInfoEl.addEventListener('click', async (event) => {
  const deleteButton = event.target.closest('.model-delete');
  if (deleteButton) {
    deleteButton.disabled = true;
    await deleteModel(deleteButton.dataset.deleteModel);
    deleteButton.disabled = false;
    return;
  }

  const button = event.target.closest('.model-action');
  if (!button) return;
  button.disabled = true;
  await activateModel(button.dataset.model);
  button.disabled = false;
});

async function deleteModel(modelId) {
  const model = modelCatalog.find((item) => item.id === modelId);
  const label = model?.label || modelId;
  const ok = window.confirm(`Delete ${label} from this device? You can download it again later.`);
  if (!ok) return;

  try {
    operationStartedAt = Date.now();
    operationLabel = `Deleting ${label}...`;
    startProgressLoop();
    setProgress('indeterminate', `Deleting ${label}...`);
    setStatus(`Deleting ${label} from the local model cache...`);
    await window.dictation.deleteModel({ modelSize: modelId });
    if (modelEl.value === modelId) {
      modelEl.value = 'small.en';
      computeDeviceEl.value = computeDeviceEl.value === 'cuda' ? 'cpu' : computeDeviceEl.value;
      await saveSettings();
    }
    await refreshModels();
    setProgress('determinate', 'Model deleted', 100);
    setStatus(`${label} deleted from this device.`);
  } catch (error) {
    setStatus(`Model delete failed: ${error.message}`);
  } finally {
    operationStartedAt = 0;
    operationLabel = '';
    setTimeout(stopProgressLoop, 1200);
  }
}

useRecommendedButtonEl.addEventListener('click', async () => {
  computeDeviceEl.value = 'cpu';
  await activateModel('small.en');
});

openDeveloperEl.addEventListener('click', async () => {
  settingsDialogEl.close();
  setView('developer');
  settingsButtonEl.classList.remove('active');
  developerButtonEl.classList.add('active');
  await refreshGpuStatus();
});

developerButtonEl.addEventListener('click', async () => {
  setView('developer');
  await refreshGpuStatus();
});

backToSettingsEl.addEventListener('click', async () => {
  settingsButtonEl.click();
});

refreshGpuEl.addEventListener('click', refreshGpuStatus);

developerModeEl.addEventListener('change', async () => {
  settings.developerMode = developerModeEl.checked;
  if (!settings.developerMode) {
    settings.developerCudaEnabled = false;
    computeDeviceEl.value = 'cpu';
  }
  await saveSettings();
  setStatus(settings.developerMode ? 'Developer options enabled' : 'Developer options disabled');
});

developerCudaEl.addEventListener('change', async () => {
  settings.developerCudaEnabled = developerCudaEl.checked;
  computeDeviceEl.value = settings.developerCudaEnabled ? 'cuda' : 'cpu';
  settings.computeDevice = computeDeviceEl.value;
  settings.computeType = settings.developerCudaEnabled ? 'float16' : 'int8';
  await saveSettings();
  setStatus(settings.developerCudaEnabled ? 'CUDA mode enabled. If it crashes, return here and turn it off.' : 'CUDA mode disabled');
});

for (const el of [deviceEl, modelEl, computeDeviceEl, addModeEl]) {
  el.addEventListener('change', () => saveSettings().catch((error) => setStatus(`Error: ${error.message}`)));
}

window.dictation.onTrayRecord(startRecording);
window.dictation.onTrayStop(stopRecording);
window.dictation.onWorkerExit((code) => {
  setRecording(false);
  stopProgressLoop();
  setProgress('determinate', 'Worker restarting', 0);
  setDone('');
  setStatus(`Speech engine restarted after an error${code ? ` (${code})` : ''}. Use CPU mode for stability.`);
});

boot();
