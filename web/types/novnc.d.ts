declare module "@novnc/novnc" {
  type RFBOptions = {
    credentials?: {
      password?: string;
      username?: string;
      target?: string;
    };
    shared?: boolean;
    wsProtocols?: string[];
  };

  export default class RFB {
    constructor(target: HTMLElement, url: string, options?: RFBOptions);
    scaleViewport: boolean;
    resizeSession: boolean;
    viewOnly: boolean;
    disconnect(): void;
    addEventListener(type: string, listener: EventListener): void;
  }
}
