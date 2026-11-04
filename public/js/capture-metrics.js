// Ported from rice-exp-lab/Multi-Phone-Splat, commit 85ad82f.
// Retains sequenceIndex grouping and actualLeaderNs as timing authority.
function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}


function observedIntervalNs(frames) {
  const saved = frames
    .filter(frame => frame.event === 'sequenceFrameSaved' && frame.actualLeaderNs != null)
    .sort((a, b) => Number(a.sequenceIndex) - Number(b.sequenceIndex));
  const intervals = [];
  for (let index = 1; index < saved.length; index += 1) {
    const sequenceDelta = Number(saved[index].sequenceIndex) - Number(saved[index - 1].sequenceIndex);
    const timeDelta = Number(saved[index].actualLeaderNs) - Number(saved[index - 1].actualLeaderNs);
    if (sequenceDelta > 0 && Number.isFinite(timeDelta)) intervals.push(Math.round(timeDelta / sequenceDelta));
  }
  return median(intervals);
}

function analyseCaptureReport(report, phones = []) {
  const results = Array.isArray(report.results) ? report.results : [];
  const frameCount = Number(report.frameCount) || 0;
  const phoneByIp = new Map(phones.map(phone => [phone.ip, phone]));
  const perPhone = results.map(result => {
    const frames = Array.isArray(result.frames) ? result.frames : [];
    const saved = frames.filter(frame => frame.event === 'sequenceFrameSaved').length;
    const dropped = frames.filter(frame => frame.event === 'sequenceFrameDropped').length;
    return {
      host: result.host,
      serial: phoneByIp.get(result.host)?.serial || null,
      ok: Boolean(result.ok),
      saved,
      dropped,
      recorded: frames.length,
      expected: frameCount,
      observedIntervalNs: observedIntervalNs(frames),
      phaseOffsetNs: result.phaseOffsetNs ?? 0,
      error: result.error || result.complete?.error || null
    };
  });
  const spans = [];
  for (let sequenceIndex = 0; sequenceIndex < frameCount; sequenceIndex += 1) {
    const leaders = results.flatMap(result => {
      const frame = (Array.isArray(result.frames) ? result.frames : []).find(item =>
        Number(item.sequenceIndex) === sequenceIndex &&
        item.event === 'sequenceFrameSaved' &&
        item.actualLeaderNs != null
      );
      return frame ? [Number(frame.actualLeaderNs)] : [];
    }).filter(Number.isFinite);
    if (leaders.length >= 2) spans.push(Math.max(...leaders) - Math.min(...leaders));
  }
  const saved = perPhone.reduce((sum, phone) => sum + phone.saved, 0);
  const dropped = perPhone.reduce((sum, phone) => sum + phone.dropped, 0);
  return {
    targetLeaderNs: report.targetLeaderNs ?? null,
    frameCount,
    phoneCount: phones.length || results.length,
    expectedFrames: frameCount * (phones.length || results.length),
    savedFrames: saved,
    droppedFrames: dropped,
    intervalNs: report.intervalNs ?? null,
    intervalSource: report.intervalSource ?? null,
    phaseAlignment: report.phaseAlignment ?? null,
    phaseStaggerMs: report.phaseStaggerMs ?? 0,
    perPhone,
    crossPhoneSpan: {
      groups: spans.length,
      medianNs: median(spans),
      p95Ns: percentile(spans, 0.95),
      maxNs: spans.length ? Math.max(...spans) : null
    }
  };
}


export { analyseCaptureReport, observedIntervalNs };
