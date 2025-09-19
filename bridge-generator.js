export function generateAndDownloadBridge() {
    const zip = new JSZip();

    const packageJsonContent = `{
  "name": "websim-nativefier-bridge",
  "version": "1.4.0",
  "description": "A local server to build native apps from websim projects.",
  "main": "index.js",
  "scripts": {
    "start:bridge": "node index.js",
    "start:server": "node exe-download-server.js",
    "start": "concurrently -k -n bridge,server -c auto,auto \\"npm run start:bridge\\" \\"npm run start:server\\""
  },
  "author": "",
  "license": "ISC",
  "engines": { "node": ">=18" },
  "dependencies": {
    "archiver": "^7.0.1",
    "@electron-forge/cli": "^6.4.2",
    "concurrently": "^8.2.2",
    "rimraf": "^5.0.7",
    "ws": "^8.17.1"
  }
}
`;

    const indexJsContent = "const WebSocket=require(\"ws\");const fs=require(\"fs\");const path=require(\"path\");const { buildWithForge }=require(\"./forge-builder\");const PORT=3001;const wss=new WebSocket.Server({port:PORT});console.log(\"WebSocket bridge listening on ws://localhost:\"+PORT);function ensureDirs(){for(const d of [\"builds\",\"dist\"]){const p=path.join(__dirname,d);if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true});}}ensureDirs();wss.on(\"connection\",(ws)=>{console.log(\"Client connected\");ws.on(\"message\",async(message)=>{let data;try{data=JSON.parse(message);}catch{return ws.send(JSON.stringify({type:\"build_error\",error:\"Invalid request\"}));}if(data.type!==\"start_build\") return;const { requestId }=data;try{ws.send(JSON.stringify({type:\"build_progress\",message:\"Starting Electron Forge build...\",requestId}));const result=await buildWithForge({...data,outputDir:path.join(__dirname,\"builds\"),distDir:path.join(__dirname,\"dist\")},ws);ws.send(JSON.stringify({type:\"build_complete\",fileName:result.fileName,appName:data.appName,requestId,downloadUrl:\"/download?file=\"+encodeURIComponent(result.fileName)}));}catch(err){console.error(err);ws.send(JSON.stringify({type:\"build_error\",error:String(err&&err.message||err),requestId}));}});ws.on(\"close\",()=>console.log(\"Client disconnected\"));});";

    const exeServerContent = "const http = require(\"http\");const fs = require(\"fs\");const path = require(\"path\");const DIST_DIR = path.join(__dirname, \"dist\");const PORT = 3002;const server = http.createServer((req, res) => {if (req.url.startsWith(\"/download?file=\")) {const fileName = decodeURIComponent(req.url.split(\"=\")[1] || \"\");if (path.normalize(fileName).includes(\"..\") || !fileName.endsWith(\".zip\")) {res.writeHead(400);return res.end(\"Invalid request\");}const filePath = path.join(DIST_DIR, fileName);if (!fs.existsSync(filePath)) {res.writeHead(404);return res.end(\"File not found\");}res.writeHead(200, {\"Content-Type\":\"application/zip\",\"Content-Disposition\":\"attachment; filename=\\\"\" + fileName + \"\\\"\",\"Access-Control-Allow-Origin\":\"*\"});fs.createReadStream(filePath).pipe(res);} else {res.writeHead(404);res.end(\"Not found\");}});server.listen(PORT, \"localhost\", () => {console.log(\"Download server running at http://localhost:\" + PORT);});";

    const forgeBuilderContent = "const { exec }=require(\"child_process\");const fs=require(\"fs\");const path=require(\"path\");const { rimraf }=require(\"rimraf\");function run(cmd,opts={}){return new Promise((resolve,reject)=>{const p=exec(cmd,{maxBuffer:1024*1024*10,...opts},(err,stdout,stderr)=>{if(err) return reject(err);resolve({stdout,stderr});});p.stdout&&p.stdout.pipe(process.stdout);p.stderr&&p.stderr.pipe(process.stderr);});}function mapPlatform(p){if(p===\"windows\") return \"win32\";if(p===\"mac\") return \"darwin\";return \"linux\";}async function buildWithForge(opts,ws){const { url,platform,arch,appName=\"MyApp\",outputDir,distDir,requestId }=opts;const safeName=(appName||\"MyApp\").replace(/[^a-zA-Z0-9.-]/g,\"\")||\"MyApp\";const workDir=path.join(outputDir,safeName+\"-\"+Date.now());const srcDir=path.join(workDir,\"src\");const forgePlatform=mapPlatform(platform);fs.mkdirSync(srcDir,{recursive:true});fs.mkdirSync(distDir,{recursive:true});const pkg={name:safeName.toLowerCase(),productName:safeName,version:\"1.0.0\",main:\"src/main.js\",private:true,scripts:{start:\"electron-forge start\",package:\"electron-forge package\",make:\"electron-forge make\",publish:\"electron-forge publish\"},config:{makers:[{name:\"@electron-forge/maker-zip\"}]},devDependencies:{electron:\"^30.0.0\",\"@electron-forge/cli\":\"^6.4.2\",\"@electron-forge/maker-zip\":\"^6.4.2\"}};fs.writeFileSync(path.join(workDir,\"package.json\"),JSON.stringify(pkg,null,2));fs.writeFileSync(path.join(workDir,\"config.json\"),JSON.stringify({url},null,2));const mainJs=\"const { app, BrowserWindow } = require(\\\\\\\"electron\\\\\\\");const path=require(\\\\\\\"path\\\\\\\");function createWindow(){const cfg=require(path.join(__dirname,\\\\\\\"..\\\\\\\",\\\\\\\"config.json\\\\\\\"));const win=new BrowserWindow({width:1280,height:800,webPreferences:{nodeIntegration:false,contextIsolation:true}});win.setMenu(null);win.loadURL(cfg.url);}app.whenReady().then(createWindow);app.on(\\\\\\\"window-all-closed\\\\\\\",()=>{if(process.platform!==\\\\\\\"darwin\\\\\\\") app.quit();});\";fs.writeFileSync(path.join(srcDir,\"main.js\"),mainJs);ws&&ws.send(JSON.stringify({type:\"build_progress\",message:\"Installing app dependencies...\",requestId}));await run(\"npm install --omit=optional\",{cwd:workDir});ws&&ws.send(JSON.stringify({type:\"build_progress\",message:\"Packaging with Electron Forge...\",requestId}));const makeCmd=\"npm run make -- --platform \"+forgePlatform+\" --arch \"+arch;await run(makeCmd,{cwd:workDir});const makeDir=path.join(workDir,\"out\",\"make\");if(!fs.existsSync(makeDir)) throw new Error(\"Forge output not found\");let foundZip=null;const walk=dir=>{for(const f of fs.readdirSync(dir)){const fp=path.join(dir,f);const stat=fs.statSync(fp);if(stat.isDirectory()) walk(fp);else if(f.endsWith(\".zip\")) foundZip=foundZip||fp;}};walk(makeDir);if(!foundZip) throw new Error(\"No zip artifact produced by Electron Forge\");const outName=safeName+\"_\"+platform+\"_\"+Date.now()+\".zip\";const dest=path.join(distDir,outName);fs.copyFileSync(foundZip,dest);await rimraf(workDir);return{zipPath:dest,fileName:outName};}module.exports={buildWithForge};";

    zip.file("package.json", packageJsonContent);
    zip.file("index.js", indexJsContent);
    zip.file("exe-download-server.js", exeServerContent);
    zip.file("forge-builder.js", forgeBuilderContent);
    zip.folder("builds");
    zip.folder("dist");

    zip.generateAsync({ type: "blob" })
        .then(function(content) {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = "websim-bridge.zip";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
}