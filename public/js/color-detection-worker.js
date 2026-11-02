import {detectColorChart} from './color-chart-detection.js';
self.onmessage=({data})=>{
  try{self.postMessage({result:detectColorChart(data.image,data.chart)});}
  catch(error){self.postMessage({error:error.message});}
};
