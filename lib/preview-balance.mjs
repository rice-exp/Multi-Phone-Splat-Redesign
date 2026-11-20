// The phone chooses exposure and white balance. This step sends neither
// manual sensor gains nor a chart correction matrix to CameraScope.
export function previewBalanceCommand() {
  return {cmd:'set',autoExposureEnabled:true,colorProcessing:{
    awbMode:'AUTO',awbLock:false,colorCorrectionMode:'FAST',tonemapMode:'FAST'
  }};
}

export function verifyPreviewBalance(state) {
  const color=state?.colorProcessing;
  const checks=[
    ['auto exposure',true,state?.autoExposureEnabled],['white balance','AUTO',color?.awbMode],
    ['white balance lock',false,color?.awbLock],['color correction','FAST',color?.colorCorrectionMode],
    ['tone mapping','FAST',color?.tonemapMode]
  ];
  const missing=[],different=[];
  for(const [label,want,reported] of checks) {
    if(reported==null)missing.push(label);
    else if(reported!==want)different.push(`${label}: requested ${want}, reported ${reported}`);
  }
  const status=different.length?'mismatch':missing.length===checks.length?'unverified':missing.length?'partial':'confirmed';
  const visibleMissing=missing.filter(label=>label!=='auto exposure');
  const message=[
    status==='confirmed'?'The phone reports the requested automatic settings.':status==='partial'&&!visibleMissing.length?'Preview balance requested.':status==='partial'?'The phone confirms some settings.':'The automatic settings could not all be confirmed.',
    different.length?`Settings differ: ${different.join('; ')}.`:'',
    visibleMissing.length?`Not reported: ${visibleMissing.join(', ')}.`:''
  ].filter(Boolean).join(' ');
  return {status,message,showWarning:status==='partial'&&visibleMissing.length>0};
}
