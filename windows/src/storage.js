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

// A picker AbortError does not distinguish user cancellation from a protected
// directory dialog being dismissed. Do not assert that the folder has OS files.
export function folderFailureNotice(error) {
  const canceled=error?.name==='AbortError';
  return {
    code:error?.name||'Error',
    detail:String(error?.message||error||''),
    message:canceled
      ?'폴더 선택이 취소되었거나 브라우저에서 선택한 폴더의 접근을 허용하지 않았습니다.'
      :'브라우저에서 폴더 직접 저장을 허용하지 않았거나 이 환경에서 지원하지 않습니다.',
    guidance:'“시스템 파일” 안내만으로 실제 폴더 안에 시스템 파일이 있다고 단정할 수 없습니다. 보호 경로·file 출처 권한·회사 정책에 따른 제한일 수 있습니다. 허용되는 일반 하위 폴더를 다시 선택하거나 아래 PDF 다운로드를 사용하세요.',
  };
}
