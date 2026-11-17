// Browser-managed folder handles only; input File paths are never inferred.
export function canChooseFolder(scope = globalThis) {
  return scope.isSecureContext === true && typeof scope.showDirectoryPicker === 'function';
}
export class FolderUnavailable extends Error {}
export async function chooseFolder(scope = globalThis) {
  if (!canChooseFolder(scope)) throw new FolderUnavailable('이 환경은 폴더 직접 저장을 지원하지 않습니다. 개별 다운로드를 사용하세요.');
  return scope.showDirectoryPicker({mode:'readwrite'});
}
export async function writeMemo(handle, filename, data) {
  if (!handle || !/^[\d]{4} 20\d{2}(?:고단|고정)\d+\.pdf$/.test(filename)) throw Error('저장 폴더 또는 메모 파일명이 올바르지 않습니다.');
  if (typeof handle.queryPermission === 'function') {
    let permission = await handle.queryPermission({mode:'readwrite'});
    if (permission !== 'granted' && typeof handle.requestPermission === 'function') permission = await handle.requestPermission({mode:'readwrite'});
    if (permission !== 'granted') throw new FolderUnavailable('폴더 쓰기 권한이 없습니다. 개별 다운로드를 사용하세요.');
  }
  // Never open an existing file for writing. FSA has no atomic create-exclusive API.
  try {
    await handle.getFileHandle(filename);
    throw Error(`같은 이름의 파일이 있습니다. 덮어쓰지 않았습니다: ${filename}`);
  } catch (error) {
    if (error.name !== 'NotFoundError') throw error;
  }
  let file, stream;
  try {
    file = await handle.getFileHandle(filename, {create:true});
    stream = await file.createWritable({keepExistingData:false});
    await stream.write(data);
    await stream.close();
  } catch (error) {
    if (stream) try { await stream.abort(); } catch {}
    if (['NotAllowedError','SecurityError','NotSupportedError'].includes(error.name)) throw new FolderUnavailable(`폴더 저장이 제한되었습니다: ${error.message}`);
    throw error;
  }
}
