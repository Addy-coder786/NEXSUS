// The package entry runs a debug script when required directly; the library file is the parser.
declare module 'pdf-parse/lib/pdf-parse.js' {
  import pdf from 'pdf-parse';
  export default pdf;
}
