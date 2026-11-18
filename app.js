const METRICS = {
  temperature: { label: "Temperatura", color: "#ffab45", unit: "°C", field: "temperature" },
  cpu: { label: "CPU", color: "#5eb4ff", unit: "%", field: "cpu" },
  ram: { label: "RAM", color: "#54d69b", unit: "%", field: "ram" },
  swap: { label: "Swap", color: "#c799ff", unit: "%", field: "swap" },
};

const chart = document.querySelector("#chart");
const plotArea = document.querySelector("#plot-area");
const tooltip = document.querySelector("#tooltip");
const fileInput = document.querySelector("#csv-file");
const startInput = document.querySelector("#start-date");
const endInput = document.querySelector("#end-date");
const statusEl = document.querySelector("#chart-status");
const emptyMessage = document.querySelector("#empty-message");
const countEl = document.querySelector("#records-count");
const periodDescription = document.querySelector("#period-description");
let readings = [];
let visibleReadings = [];
let activeMetrics = [];
let plot = null;

function numberFrom(value) {
  const match = String(value ?? "").replace(",", ".").match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseCsv(contents) {
  const lines = contents.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const header = (lines.shift() || "").split(";").map((item) => item.trim().toLowerCase());
  const columns = {
    date: header.indexOf("data_hora"), temperature: header.indexOf("temperatura"),
    cpu: header.indexOf("cpu_percentual"), ram: header.indexOf("ram_percentual"), swap: header.indexOf("swap_percentual"),
  };
  if (Object.values(columns).some((index) => index < 0)) throw new Error("Colunas esperadas: data_hora, temperatura, cpu_percentual, ram_percentual e swap_percentual.");

  return lines.map((line) => {
    const values = line.split(";");
    const timestamp = new Date((values[columns.date] || "").trim().replace(" ", "T"));
    return {
      timestamp,
      temperature: numberFrom(values[columns.temperature]),
      cpu: numberFrom(values[columns.cpu]),
      ram: numberFrom(values[columns.ram]),
      swap: numberFrom(values[columns.swap]),
    };
  }).filter((item) => !Number.isNaN(item.timestamp.getTime())).sort((a, b) => a.timestamp - b.timestamp);
}

function formatValue(value, unit) {
  return value == null ? "N/D" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}${unit}`;
}

function shortDate(date) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function detailedDate(date) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(date);
}

function inputDateValue(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function updateSummary() {
  const latest = readings.at(-1);
  if (!latest) return;
  document.querySelector("#last-temperature").textContent = formatValue(latest.temperature, "°C");
  document.querySelector("#last-cpu").textContent = formatValue(latest.cpu, "%");
  document.querySelector("#last-ram").textContent = formatValue(latest.ram, "%");
  document.querySelector("#last-swap").textContent = formatValue(latest.swap, "%");
  document.querySelector("#temperature-note").textContent = `última leitura: ${shortDate(latest.timestamp)}`;
}

function applyFilters() {
  const from = startInput.value ? new Date(startInput.value) : null;
  const until = endInput.value ? new Date(endInput.value) : null;
  activeMetrics = [...document.querySelectorAll('input[name="metric"]:checked')].map((input) => input.value);
  visibleReadings = readings.filter((row) => (!from || row.timestamp >= from) && (!until || row.timestamp <= until));

  countEl.textContent = `${visibleReadings.length.toLocaleString("pt-BR")} de ${readings.length.toLocaleString("pt-BR")} medições exibidas`;
  statusEl.textContent = activeMetrics.length ? `${activeMetrics.length} métrica${activeMetrics.length > 1 ? "s" : ""}` : "Sem métricas";
  drawChart();
}

function setCanvasSize() {
  const ratio = window.devicePixelRatio || 1;
  const { width, height } = plotArea.getBoundingClientRect();
  chart.width = Math.round(width * ratio);
  chart.height = Math.round(height * ratio);
  const context = chart.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width, height };
}

function drawText(ctx, value, x, y, options = {}) {
  ctx.save();
  ctx.fillStyle = options.color || "#90a2be";
  ctx.font = options.font || "11px Inter, system-ui, sans-serif";
  ctx.textAlign = options.align || "left";
  ctx.textBaseline = options.baseline || "middle";
  ctx.fillText(value, x, y);
  ctx.restore();
}

function temperatureScale(rows) {
  const values = rows.map((item) => item.temperature).filter((value) => value != null);
  if (!values.length) return { min: 0, max: 100 };
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const spacing = rawMax - rawMin < 8 ? 5 : Math.ceil((rawMax - rawMin) / 4 / 5) * 5;
  return { min: Math.max(0, Math.floor((rawMin - spacing) / 5) * 5), max: Math.ceil((rawMax + spacing) / 5) * 5 };
}

function drawChart() {
  const { context: ctx, width, height } = setCanvasSize();
  ctx.clearRect(0, 0, width, height);
  const hasValues = visibleReadings.length > 0 && activeMetrics.length > 0;
  emptyMessage.hidden = hasValues;
  chart.style.display = hasValues ? "block" : "none";
  if (!hasValues) { plot = null; return; }

  const bounds = { left: 50, right: width - 56, top: 22, bottom: height - 42 };
  const widthPlot = bounds.right - bounds.left;
  const heightPlot = bounds.bottom - bounds.top;
  const minTime = visibleReadings[0].timestamp.getTime();
  const maxTime = visibleReadings.at(-1).timestamp.getTime();
  const timeRange = Math.max(1, maxTime - minTime);
  const hasTemperature = activeMetrics.includes("temperature");
  const tempRange = temperatureScale(visibleReadings);
  const xFor = (date) => bounds.left + ((date.getTime() - minTime) / timeRange) * widthPlot;
  const percentageY = (value) => bounds.bottom - (value / 100) * heightPlot;
  const temperatureY = (value) => bounds.bottom - ((value - tempRange.min) / Math.max(1, tempRange.max - tempRange.min)) * heightPlot;

  ctx.fillStyle = "#09172a";
  ctx.fillRect(bounds.left, bounds.top, widthPlot, heightPlot);
  for (let i = 0; i <= 4; i += 1) {
    const y = bounds.bottom - (i / 4) * heightPlot;
    ctx.strokeStyle = "#203958";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(bounds.left, y); ctx.lineTo(bounds.right, y); ctx.stroke();
    drawText(ctx, `${i * 25}%`, bounds.left - 8, y, { align: "right" });
    if (hasTemperature) drawText(ctx, `${(tempRange.min + ((tempRange.max - tempRange.min) * i / 4)).toFixed(0)}°`, bounds.right + 8, y, { color: "#d9a45f" });
  }
  for (let i = 0; i <= 4; i += 1) {
    const time = new Date(minTime + timeRange * i / 4);
    const x = xFor(time);
    ctx.strokeStyle = "#172e4c";
    ctx.beginPath(); ctx.moveTo(x, bounds.top); ctx.lineTo(x, bounds.bottom); ctx.stroke();
    drawText(ctx, shortDate(time), x, bounds.bottom + 18, { align: "center", font: "10px Inter, system-ui, sans-serif" });
  }

  activeMetrics.forEach((key) => {
    const metric = METRICS[key];
    const yFor = key === "temperature" ? temperatureY : percentageY;
    ctx.beginPath();
    let hasPoint = false;
    visibleReadings.forEach((row) => {
      const value = row[metric.field];
      if (value == null) return;
      const x = xFor(row.timestamp);
      const y = yFor(value);
      if (!hasPoint) { ctx.moveTo(x, y); hasPoint = true; } else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = metric.color;
    ctx.lineWidth = 1.65;
    ctx.lineJoin = "round";
    ctx.stroke();
  });

  plot = { bounds, minTime, maxTime, xFor, temperatureY, percentageY };
}

function closestReading(timestamp) {
  let first = 0;
  let last = visibleReadings.length - 1;
  while (first < last) {
    const middle = Math.floor((first + last) / 2);
    if (visibleReadings[middle].timestamp.getTime() < timestamp) first = middle + 1;
    else last = middle;
  }
  const candidate = visibleReadings[first];
  const previous = visibleReadings[Math.max(0, first - 1)];
  return Math.abs(previous.timestamp - timestamp) < Math.abs(candidate.timestamp - timestamp) ? previous : candidate;
}

function showTooltip(event) {
  if (!plot || !visibleReadings.length) return;
  const rect = chart.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  if (pointerX < plot.bounds.left || pointerX > plot.bounds.right) { tooltip.style.display = "none"; return; }
  const mappedTime = plot.minTime + ((pointerX - plot.bounds.left) / (plot.bounds.right - plot.bounds.left)) * (plot.maxTime - plot.minTime);
  const row = closestReading(mappedTime);
  tooltip.innerHTML = `<strong>${detailedDate(row.timestamp)}</strong>${activeMetrics.map((key) => `<span style="color:${METRICS[key].color}">${METRICS[key].label}: ${formatValue(row[METRICS[key].field], METRICS[key].unit)}</span>`).join("")}`;
  const tooltipWidth = 180;
  tooltip.style.left = `${Math.min(Math.max(pointerX + 14, 5), rect.width - tooltipWidth)}px`;
  tooltip.style.top = `${Math.min(Math.max(event.clientY - rect.top + 12, 5), rect.height - 126)}px`;
  tooltip.style.display = "block";
}

function initialize(data, sourceLabel) {
  readings = data;
  if (!readings.length) throw new Error("Nenhuma linha válida foi encontrada no arquivo.");
  startInput.min = endInput.min = inputDateValue(readings[0].timestamp);
  startInput.max = endInput.max = inputDateValue(readings.at(-1).timestamp);
  startInput.value = inputDateValue(readings[0].timestamp);
  endInput.value = inputDateValue(readings.at(-1).timestamp);
  periodDescription.textContent = `${readings.length.toLocaleString("pt-BR")} medições carregadas de ${sourceLabel} · ${shortDate(readings[0].timestamp)} a ${shortDate(readings.at(-1).timestamp)}`;
  updateSummary();
  applyFilters();
}

async function loadDefaultFile() {
  try {
    const response = await fetch("../../monitoramento_log.csv", { cache: "no-store" });
    if (!response.ok) throw new Error("arquivo não encontrado");
    initialize(parseCsv(await response.text()), "monitoramento_log.csv");
  } catch (error) {
    periodDescription.textContent = "Não foi possível carregar o CSV automaticamente. Selecione o arquivo no botão acima.";
    statusEl.textContent = "Aguardando CSV";
    countEl.textContent = "Use o mesmo formato do arquivo fornecido.";
    emptyMessage.hidden = false;
    emptyMessage.textContent = "Selecione o arquivo monitoramento_log.csv para visualizar os dados.";
    chart.style.display = "none";
  }
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try { initialize(parseCsv(await file.text()), file.name); }
  catch (error) { alert(`Não foi possível ler o arquivo: ${error.message}`); }
});
document.querySelectorAll("input[name=metric]").forEach((input) => input.addEventListener("change", applyFilters));
startInput.addEventListener("change", applyFilters);
endInput.addEventListener("change", applyFilters);
document.querySelector("#reset-filters").addEventListener("click", () => {
  if (!readings.length) return;
  startInput.value = inputDateValue(readings[0].timestamp);
  endInput.value = inputDateValue(readings.at(-1).timestamp);
  document.querySelectorAll("input[name=metric]").forEach((input) => { input.checked = true; });
  applyFilters();
});
chart.addEventListener("mousemove", showTooltip);
chart.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });
window.addEventListener("resize", () => { if (readings.length) drawChart(); });

loadDefaultFile();
