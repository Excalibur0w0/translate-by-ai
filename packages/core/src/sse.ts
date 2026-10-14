/**
 * 增量解析 text/event-stream。每个完整事件的 data 字段（多行以 \n 拼接）回调给 onData，
 * 注释行（以 ":" 开头，如 OpenRouter 的 ": OPENROUTER PROCESSING"）和其它字段被忽略。
 */
export function createSSEParser(onData: (data: string) => void) {
  let buffer = '';
  let dataLines: string[] = [];

  const dispatch = () => {
    if (dataLines.length > 0) onData(dataLines.join('\n'));
    dataLines = [];
  };

  const processLine = (line: string) => {
    if (line === '') return dispatch();
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== 'data') return;
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    dataLines.push(value);
  };

  return {
    feed(chunk: string) {
      buffer += chunk;
      // 末尾单独的 \r 可能是被拆开的 \r\n，留到下一块再处理
      const lines = buffer.split(/\r\n|\n|\r(?!$)/);
      buffer = lines.pop() ?? '';
      for (const line of lines) processLine(line);
    },
    end() {
      if (buffer) processLine(buffer.replace(/\r$/, ''));
      buffer = '';
      dispatch();
    },
  };
}
