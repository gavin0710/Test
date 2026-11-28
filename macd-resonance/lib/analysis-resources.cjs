// One runtime inventory for authenticated serving, deployment and acceptance.
const catalog=require('../analysis-app.js');
const pages=['analysis.html',...catalog.map(p=>p.href)];
const staticFiles=[...pages,'analysis.css','analysis-app.js','analysis-metrics.js','analysis-patterns.js','analysis-nine.js','analysis-nine-charts.js','analysis-trades.js','analysis-early.js','analysis-early-view.js','analysis-research-charts.js','analysis-macd.js'];
const runtimeFiles=['index.html',...staticFiles,'analysis-data.json','api/access.js','lib/site-access.cjs','lib/analysis-resources.cjs','api/latest.js','api/history.js','vercel.json'];
module.exports={pages,staticFiles,runtimeFiles};
