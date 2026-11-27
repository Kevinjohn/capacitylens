declare module 'jsdom' {
  export class JSDOM {
    static fragment(source: string): {
      querySelectorAll(selector: string): Iterable<{ id: string }>
    }
  }
}
