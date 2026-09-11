import { describe, it, expect } from 'vitest';
import { JsonLines, FRAME_LIMIT } from './protocol';

describe('terminal service framing',()=>{
  it('handles split messages, multiple frames and escaped newlines',()=>{
    const reader=new JsonLines(),received:any[]=[];
    reader.push('{"data":"hello',m=>received.push(m));
    reader.push('\\nworld"}\n\n{"rid":2}\n',m=>received.push(m));
    expect(received).toEqual([{data:'hello\nworld'},{rid:2}]);
  });
  it('rejects malformed JSON and oversized frames',()=>{
    expect(()=>new JsonLines().push('invalid\n',()=>{})).toThrow();
    expect(()=>new JsonLines().push('x'.repeat(FRAME_LIMIT+1),()=>{})).toThrow('exceeded limit');
    expect(()=>new JsonLines().push('x'.repeat(FRAME_LIMIT+1)+'\n',()=>{})).toThrow('exceeded limit');
  });
});
