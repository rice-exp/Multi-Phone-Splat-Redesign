import dgram from 'node:dgram';

export function rigError(code, message, next, status = 503) {
  return Object.assign(new Error(message), {code, next, status});
}

// Both CloneCameraScope and CameraScope/kp-camerascope-test use JSON over
// UDP 5010. Only read-only getState requests are safe to repeat automatically.
export function sendCommand(host, payload, {port = 5010, timeoutMs = 3000, retryMs = 700} = {}) {
  const bytes = Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    let settled = false, retry, attempts = 0;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(retry);
      try { socket.close(); } catch {}
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(rigError('PHONE_TIMEOUT', `CameraScope did not respond within ${timeoutMs / 1000} seconds.`,
      'Keep CameraScope open. Check the phone IP, private Wi-Fi network and UDP command port 5010.')), timeoutMs);
    const networkError = error => finish(rigError('PHONE_NETWORK', error.message, 'Check the private network and phone IP.'));
    socket.on('error', networkError);
    socket.on('message', (data, sender) => {
      if (sender.address !== host || sender.port !== port) return;
      try {
        const response = JSON.parse(data.toString('utf8'));
        // Newer builds also send asynchronous completion events. Neither an
        // event nor another command's reply acknowledges this request.
        if (response?.event || (response?.cmd && response.cmd !== payload.cmd)) return;
        if (!response || typeof response !== 'object' || Array.isArray(response) || response.ok !== true) {
          throw new Error(response?.error || 'Missing successful CameraScope acknowledgement.');
        }
        finish(null, response);
      } catch (error) {
        finish(rigError('PHONE_RESPONSE', error.message, 'Inspect technical details and check the installed CameraScope version.'));
      }
    });
    const send = () => {
      if (settled) return;
      attempts++;
      socket.send(bytes, port, host, error => { if (error) networkError(error); });
      if (payload.cmd === 'getState' && attempts < 3) retry = setTimeout(send, Math.max(1, retryMs));
    };
    send();
  });
}

// Feature detection is per phone: a rig may contain both app versions.
// kp-camerascope-test reports streamCodec; legacy builds are fixed H.264.
export const configurableStream = state => typeof state?.streamCodec === 'string' && !!state.streamCodec;
export const compatibleStream = state => !configurableStream(state) || state.streamCodecActive === 'avc';

export function previewPayload(phone, destination, enable) {
  if (!enable) return {cmd:'set', streamEnabled:false};
  return {cmd:'set', udpHost:destination, udpVideoPort:phone.previewRoute.videoPort,
    udpMetadataPort:phone.previewRoute.metadataPort, streamEnabled:true,
    ...(configurableStream(phone.state) ? {streamCodec:'avc', streamEncoder:''} : {}),
    ...(phone.state.isCapturing ? {} : {capture:true})};
}

export function previewIssue(state) {
  if (!state?.streamEnabled || !configurableStream(state)) return null;
  if (state.streamError && !state.streamCodecActive) return {
    code:'PREVIEW_ENCODER_FAILED', message:`CameraScope could not start its video encoder: ${state.streamError}`,
    next:'Check the phone’s CameraScope log and stream resolution/bitrate. Start selected previews to use the automatic H.264 encoder.'
  };
  if ((state.streamCodecActive && state.streamCodecActive !== 'avc') || (!state.streamCodecActive && state.streamCodec !== 'avc')) return {
    code:'PREVIEW_CODEC_UNSUPPORTED', message:`CameraScope is using ${state.streamCodecActive || state.streamCodec}; this preview gateway requires H.264.`,
    next:'Click Start selected previews to switch this phone’s stream to H.264.'
  };
  return null;
}
