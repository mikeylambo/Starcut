export type InputDeviceFamily="keyboard-mouse"|"xbox"|"playstation"|"nintendo"|"touch"|"generic-gamepad";

export interface InputGlyph {
  action:string;
  family:InputDeviceFamily;
  label:string;
  assetId?:string;
}

export class InputGlyphRegistry {
  private readonly glyphs=new Map<string,InputGlyph>();
  private family:InputDeviceFamily="keyboard-mouse";

  register(glyphs:readonly InputGlyph[]):void{
    for(const glyph of glyphs)this.glyphs.set(this.key(glyph.action,glyph.family),{...glyph});
  }
  setFamily(family:InputDeviceFamily):void{this.family=family;}
  get activeFamily():InputDeviceFamily{return this.family;}
  resolve(action:string,family:InputDeviceFamily=this.family):InputGlyph|null{
    const exact=this.glyphs.get(this.key(action,family));
    const generic=this.glyphs.get(this.key(action,"generic-gamepad"));
    const keyboard=this.glyphs.get(this.key(action,"keyboard-mouse"));
    return exact?{...exact}:generic?{...generic}:keyboard?{...keyboard}:null;
  }
  private key(action:string,family:InputDeviceFamily):string{return `${family}:${action}`;}
}
