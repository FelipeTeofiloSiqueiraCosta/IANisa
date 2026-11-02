import {deflateRawSync,crc32} from 'node:zlib';
export function zipFixture(entries){
 const local=[],central=[];let offset=0;
 for(const entry of entries){const name=Buffer.from(entry.name),data=Buffer.from(entry.data??''),method=entry.method??0,compressed=method===8?deflateRawSync(data):data,checksum=entry.crc??crc32(data),size=entry.size??data.length,flags=entry.flags??0;
  const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50,0);l.writeUInt16LE(20,4);l.writeUInt16LE(flags,6);l.writeUInt16LE(method,8);l.writeUInt32LE(checksum,14);l.writeUInt32LE(compressed.length,18);l.writeUInt32LE(size,22);l.writeUInt16LE(name.length,26);local.push(l,name,compressed);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(0x0314,4);c.writeUInt16LE(20,6);c.writeUInt16LE(flags,8);c.writeUInt16LE(method,10);c.writeUInt32LE(checksum,16);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(size,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE((entry.mode??0o100600)*65536>>>0,38);c.writeUInt32LE(offset,42);central.push(c,name);offset+=l.length+name.length+compressed.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);
}
