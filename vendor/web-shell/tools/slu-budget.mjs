#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const configPath=path.join(root,"slu-budget.json");
if(!fs.existsSync(configPath)){
  console.log("SLU BUDGET // no slu-budget.json; skipped");
  process.exit(0);
}
const config=JSON.parse(fs.readFileSync(configPath,"utf8"));
const include=config.include??["dist"];
const extensions=new Set(config.extensions??[".js",".css",".json",".png",".jpg",".jpeg",".webp",".wav",".mp3",".ogg",".glb",".gltf"]);
const files=[];
const walk=dir=>{
  if(!fs.existsSync(dir))return;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())walk(full);
    else if(extensions.has(path.extname(entry.name).toLowerCase()))files.push({path:path.relative(root,full),bytes:fs.statSync(full).size});
  }
};
for(const target of include)walk(path.join(root,target));
const violations=[];
const totalBytes=files.reduce((sum,file)=>sum+file.bytes,0);
if(config.maxTotalBytes&&totalBytes>config.maxTotalBytes)violations.push(`total ${totalBytes} > ${config.maxTotalBytes}`);
if(config.maxFileBytes){for(const file of files)if(file.bytes>config.maxFileBytes)violations.push(`${file.path} ${file.bytes} > ${config.maxFileBytes}`);}
for(const [extension,limit] of Object.entries(config.maxBytesByExtension??{})){
  const ext=extension.startsWith(".")?extension:`.${extension}`;
  const bytes=files.filter(file=>path.extname(file.path).toLowerCase()===ext).reduce((sum,file)=>sum+file.bytes,0);
  if(bytes>limit)violations.push(`${ext} total ${bytes} > ${limit}`);
}
for(const [pattern,limit] of Object.entries(config.maxBytesByPathPrefix??{})){
  const bytes=files.filter(file=>file.path.startsWith(pattern)).reduce((sum,file)=>sum+file.bytes,0);
  if(bytes>limit)violations.push(`${pattern} total ${bytes} > ${limit}`);
}
const report={schemaVersion:1,totalBytes,fileCount:files.length,largest:[...files].sort((a,b)=>b.bytes-a.bytes).slice(0,10),violations};
console.log(JSON.stringify(report,null,2));
process.exit(violations.length?1:0);
