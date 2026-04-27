import { FFmpeg } from "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js";
import { fetchFile, toBlobURL } from "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js";

const CORE_BASE_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
const FFMPEG_WORKER_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/worker.js";

const state = {
  ffmpeg: new FFmpeg(),
  loaded: false,
  inputFile: null,
  inputUrl: null,
  outputUrl: null,
};

const els = {
  dropZone: document.querySelector("#dropZone"),
  fileInput: document.querySelector("#fileInput"),
  pickButton: document.querySelector("#pickButton"),
  inputVideo: document.querySelector("#inputVideo"),
  outputVideo: document.querySelector("#outputVideo"),
  inputMeta: document.querySelector("#inputMeta"),
  outputMeta: document.querySelector("#outputMeta"),
  qualitySelect: document.querySelector("#qualitySelect"),
  widthSelect: document.querySelector("#widthSelect"),
  audioSelect: document.querySelector("#audioSelect"),
  targetSizeInput: document.querySelector("#targetSizeInput"),
  compressButton: document.querySelector("#compressButton"),
  downloadLink: document.querySelector("#downloadLink"),
  statusText: document.querySelector("#statusText"),
  progressText: document.querySelector("#progressText"),
  progressBar: document.querySelector("#progressBar"),
  logOutput: document.querySelector("#logOutput"),
};

els.pickButton.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) {
    setInputFile(file);
  }
});

["dragenter", "dragover"].forEach((eventName) => {
  els.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropZone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  els.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("is-dragging");
  });
});

els.dropZone.addEventListener("drop", (event) => {
  const [file] = event.dataTransfer.files;
  if (file?.type.startsWith("video/")) {
    setInputFile(file);
  } else {
    setStatus("Please choose a video file.");
  }
});

els.compressButton.addEventListener("click", compressVideo);
els.inputVideo.addEventListener("loadedmetadata", updateInputMeta);

function setInputFile(file) {
  clearOutput();
  revokeUrl("inputUrl");

  state.inputFile = file;
  state.inputUrl = URL.createObjectURL(file);
  els.inputVideo.src = state.inputUrl;
  updateInputMeta();
  els.compressButton.disabled = false;
  setStatus("Choose compression settings, then start compression.");
}

async function ensureFfmpegLoaded() {
  if (state.loaded) {
    return;
  }

  setBusy(true);
  setStatus("Loading ffmpeg.wasm. The first load downloads about 30 MB.");
  state.ffmpeg.on("log", ({ message }) => appendLog(message));
  state.ffmpeg.on("progress", ({ progress }) => {
    const percent = Math.min(99, Math.max(0, Math.round(progress * 100)));
    setProgress(percent);
  });

  await state.ffmpeg.load({
    coreURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm"),
    classWorkerURL: createModuleWorkerUrl(FFMPEG_WORKER_URL),
  });

  state.loaded = true;
  setStatus("ffmpeg.wasm is ready.");
}

async function compressVideo() {
  if (!state.inputFile) {
    return;
  }

  const ffmpeg = state.ffmpeg;
  const inputName = safeFsName(state.inputFile.name, "input.mp4");
  const outputName = `compressed-${Date.now()}.mp4`;

  try {
    clearOutput();
    setBusy(true);
    setProgress(0);
    els.logOutput.textContent = "";

    await ensureFfmpegLoaded();
    setStatus("Loading the video into memory.");
    await ffmpeg.writeFile(inputName, await fetchFile(state.inputFile));

    const duration = isTargetSizeMode() ? await getInputDuration() : null;
    const { args, summary } = buildArgs(inputName, outputName, duration);
    appendLog(summary);
    appendLog(`$ ffmpeg ${args.join(" ")}`);
    setStatus("Compressing. Keep this tab open.");
    await ffmpeg.exec(args);

    const outputData = await ffmpeg.readFile(outputName);
    const outputBlob = new Blob([outputData], { type: "video/mp4" });
    state.outputUrl = URL.createObjectURL(outputBlob);

    els.outputVideo.src = state.outputUrl;
    els.outputMeta.textContent = `${formatBytes(outputBlob.size)} / ${reductionText(state.inputFile.size, outputBlob.size)}`;
    els.downloadLink.href = state.outputUrl;
    els.downloadLink.download = outputName;
    els.downloadLink.hidden = false;

    setProgress(100);
    setStatus("Compression complete.");

    await cleanupFiles(ffmpeg, [inputName, outputName]);
  } catch (error) {
    console.error(error);
    appendLog(error?.message || String(error));
    setStatus("Compression failed. Try different settings or a shorter video.");
  } finally {
    setBusy(false);
  }
}

function buildArgs(inputName, outputName, duration) {
  const crf = els.qualitySelect.value;
  const maxWidth = Number(els.widthSelect.value);
  const audio = els.audioSelect.value;
  const targetSizeMb = Number(els.targetSizeInput.value);
  const args = ["-i", inputName, "-map", "0:v:0", "-c:v", "libx264", "-preset", "veryfast"];
  const targetMode = isTargetSizeMode();
  let summary = `mode: crf\ncrf: ${crf}`;

  if (targetMode) {
    const videoBitrateKbps = calculateVideoBitrateKbps(targetSizeMb, duration, audio);
    args.push("-b:v", `${videoBitrateKbps}k`, "-maxrate", `${Math.round(videoBitrateKbps * 1.35)}k`, "-bufsize", `${videoBitrateKbps * 2}k`);
    summary = [
      "mode: target-size",
      `target_size: ${targetSizeMb} MB`,
      `duration: ${formatDuration(duration)}`,
      `video_bitrate: ${videoBitrateKbps}k`,
      `audio_bitrate: ${audio === "none" ? "none" : audio}`,
    ].join("\n");
  } else {
    args.push("-crf", crf);
  }

  if (maxWidth > 0) {
    args.push("-vf", `scale='min(${maxWidth},iw)':-2`);
    summary = `${summary}\nmax_width: ${maxWidth}px`;
  }

  if (audio === "none") {
    args.push("-an");
  } else {
    args.push("-map", "0:a?", "-c:a", "aac", "-b:a", audio);
  }

  args.push("-movflags", "+faststart", outputName);
  return { args, summary };
}

async function cleanupFiles(ffmpeg, names) {
  await Promise.all(names.map(async (name) => {
    try {
      await ffmpeg.deleteFile(name);
    } catch {
      // A failed transcode may leave one side missing.
    }
  }));
}

function clearOutput() {
  revokeUrl("outputUrl");
  els.outputVideo.removeAttribute("src");
  els.outputVideo.load();
  els.outputMeta.textContent = "Waiting";
  els.downloadLink.hidden = true;
  els.downloadLink.removeAttribute("href");
  setProgress(0);
}

function setBusy(isBusy) {
  els.compressButton.disabled = isBusy || !state.inputFile;
  els.pickButton.disabled = isBusy;
  els.qualitySelect.disabled = isBusy;
  els.widthSelect.disabled = isBusy;
  els.audioSelect.disabled = isBusy;
  els.targetSizeInput.disabled = isBusy;
}

function setStatus(message) {
  els.statusText.textContent = message;
}

function setProgress(value) {
  els.progressBar.value = value;
  els.progressText.textContent = `${value}%`;
}

function appendLog(message) {
  const next = `${message}\n`;
  els.logOutput.textContent = `${els.logOutput.textContent}${next}`.slice(-5000);
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function safeFsName(name, fallback) {
  const clean = name.replace(/[^\w.-]+/g, "_");
  return clean || fallback;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "unknown";
  }

  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

function updateInputMeta() {
  if (!state.inputFile) {
    els.inputMeta.textContent = "No file selected";
    return;
  }

  const duration = els.inputVideo.duration;
  const durationText = Number.isFinite(duration) && duration > 0 ? ` / ${formatDuration(duration)}` : "";
  els.inputMeta.textContent = `${state.inputFile.name} / ${formatBytes(state.inputFile.size)}${durationText}`;
}

async function getInputDuration() {
  if (Number.isFinite(els.inputVideo.duration) && els.inputVideo.duration > 0) {
    return els.inputVideo.duration;
  }

  await new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Could not read video duration.")), 5000);
    els.inputVideo.addEventListener("loadedmetadata", () => {
      window.clearTimeout(timeout);
      resolve();
    }, { once: true });
  });

  if (!Number.isFinite(els.inputVideo.duration) || els.inputVideo.duration <= 0) {
    throw new Error("Could not read video duration.");
  }

  return els.inputVideo.duration;
}

function calculateVideoBitrateKbps(targetSizeMb, duration, audio) {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Target size mode requires a readable video duration.");
  }

  const targetBits = targetSizeMb * 1024 * 1024 * 8;
  const containerOverheadRatio = 0.97;
  const audioKbps = audio === "none" ? 0 : parseKbps(audio);
  const totalKbps = targetBits / duration / 1000;
  const videoKbps = Math.floor((totalKbps * containerOverheadRatio) - audioKbps);

  if (videoKbps < 100) {
    throw new Error("Target size is too small for this duration and audio setting.");
  }

  return videoKbps;
}

function isTargetSizeMode() {
  const targetSizeMb = Number(els.targetSizeInput.value);
  return Number.isFinite(targetSizeMb) && targetSizeMb > 0;
}

function parseKbps(value) {
  const match = /^(\d+)k$/.exec(value);
  return match ? Number(match[1]) : 0;
}

function reductionText(inputBytes, outputBytes) {
  if (!inputBytes || outputBytes >= inputBytes) {
    return "No size reduction";
  }

  const reduction = Math.round((1 - outputBytes / inputBytes) * 100);
  return `${reduction}% smaller`;
}

function revokeUrl(key) {
  if (state[key]) {
    URL.revokeObjectURL(state[key]);
    state[key] = null;
  }
}

function createModuleWorkerUrl(url) {
  const workerSource = `import ${JSON.stringify(url)};`;
  return URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
}
