export const SOH = '\x01';

export interface FixHeader {
  beginString: string; // 8=FIX.4.4
  bodyLength?: number; // 9
  msgType: string; // 35
  senderCompId: string; // 49
  targetCompId: string; // 56
  msgSeqNum: number; // 34
  sendingTime: string; // 52
}

export interface FixMessage {
  header: FixHeader;
  fields: Map<number, string>;
  checksum?: string; // 10
}

export interface FixOrderParams {
  clOrdId: string; // 11
  symbol: string; // 55
  side: '1' | '2'; // 54 (1=Buy, 2=Sell)
  orderQty: number; // 38
  price: number; // 44
  ordType: '1' | '2'; // 40 (1=Market, 2=Limit)
  timeInForce?: '0' | '1' | '3'; // 59 (0=Day, 1=GTC, 3=IOC)
}

export interface ExecutionReportParams {
  orderId: string; // 37
  clOrdId: string; // 11
  execId: string; // 17
  execType: '0' | '4' | '8' | 'F'; // 150 (0=New, 4=Canceled, 8=Rejected, F=Trade)
  ordStatus: '0' | '1' | '2' | '4' | '8'; // 39 (0=New, 1=PartiallyFilled, 2=Filled, 4=Canceled, 8=Rejected)
  symbol: string; // 55
  side: '1' | '2'; // 54
  orderQty: number; // 38
  price: number; // 44
  lastQty?: number; // 32
  lastPx?: number; // 31
  leavesQty: number; // 151
  cumQty: number; // 14
  avgPx: number; // 6
  text?: string; // 58
}

export class FixProtocolGateway {
  private targetCompId: string;
  private senderCompId: string;
  private inSeqNum = 0;
  private outSeqNum = 0;

  constructor(senderCompId = 'OENEXA_EXCH', targetCompId = 'CLIENT_PROP') {
    this.senderCompId = senderCompId;
    this.targetCompId = targetCompId;
  }

  public static calculateChecksum(content: string): string {
    let sum = 0;
    for (let i = 0; i < content.length; i++) {
      sum += content.charCodeAt(i);
    }
    const mod = sum % 256;
    return mod.toString().padStart(3, '0');
  }

  public parseFixMessage(raw: string): FixMessage {
    const tokens = raw.split(SOH).filter((t) => t.length > 0);
    const fields = new Map<number, string>();

    for (const token of tokens) {
      const eqIdx = token.indexOf('=');
      if (eqIdx === -1) continue;
      const tag = parseInt(token.slice(0, eqIdx), 10);
      const val = token.slice(eqIdx + 1);
      fields.set(tag, val);
    }

    const beginString = fields.get(8) || 'FIX.4.4';
    const bodyLength = parseInt(fields.get(9) || '0', 10);
    const msgType = fields.get(35) || '';
    const senderCompId = fields.get(49) || '';
    const targetCompId = fields.get(56) || '';
    const msgSeqNum = parseInt(fields.get(34) || '1', 10);
    const sendingTime = fields.get(52) || '';
    const checksum = fields.get(10) || '';

    // Validate checksum integrity
    const checksumIdx = raw.indexOf(`${SOH}10=`);
    if (checksumIdx !== -1) {
      const contentToVerify = raw.slice(0, checksumIdx + 1);
      const expectedCheck = FixProtocolGateway.calculateChecksum(contentToVerify);
      if (checksum !== expectedCheck) {
        throw new Error(`FIX Checksum mismatch: expected ${expectedCheck}, received ${checksum}`);
      }
    }

    this.inSeqNum = Math.max(this.inSeqNum, msgSeqNum);

    return {
      header: {
        beginString,
        bodyLength,
        msgType,
        senderCompId,
        targetCompId,
        msgSeqNum,
        sendingTime,
      },
      fields,
      checksum,
    };
  }

  public serializeFixMessage(msgType: string, bodyFields: [number, string | number][]): string {
    this.outSeqNum += 1;
    const now = new Date().toISOString().replace('Z', '').replace('T', '-');

    let bodyStr = `35=${msgType}${SOH}49=${this.senderCompId}${SOH}56=${this.targetCompId}${SOH}34=${this.outSeqNum}${SOH}52=${now}${SOH}`;

    for (const [tag, val] of bodyFields) {
      bodyStr += `${tag}=${val}${SOH}`;
    }

    const headStr = `8=FIX.4.4${SOH}9=${bodyStr.length}${SOH}`;
    const preChecksum = headStr + bodyStr;
    const chk = FixProtocolGateway.calculateChecksum(preChecksum);

    return `${preChecksum}10=${chk}${SOH}`;
  }

  public buildLogonResponse(heartBtInt = 30): string {
    return this.serializeFixMessage('A', [
      [98, 0], // EncryptMethod: None
      [108, heartBtInt], // HeartBtInt
      [141, 'Y'], // ResetSeqNumFlag
    ]);
  }

  public buildHeartbeat(testReqId?: string): string {
    const fields: [number, string | number][] = [];
    if (testReqId) {
      fields.push([112, testReqId]);
    }
    return this.serializeFixMessage('0', fields);
  }

  public buildExecutionReport(params: ExecutionReportParams): string {
    const fields: [number, string | number][] = [
      [37, params.orderId],
      [11, params.clOrdId],
      [17, params.execId],
      [150, params.execType],
      [39, params.ordStatus],
      [55, params.symbol],
      [54, params.side],
      [38, params.orderQty],
      [44, params.price.toFixed(4)],
      [151, params.leavesQty],
      [14, params.cumQty],
      [6, params.avgPx.toFixed(4)],
    ];

    if (params.lastQty !== undefined && params.lastPx !== undefined) {
      fields.push([32, params.lastQty]);
      fields.push([31, params.lastPx.toFixed(4)]);
    }

    if (params.text) {
      fields.push([58, params.text]);
    }

    return this.serializeFixMessage('8', fields);
  }

  public parseNewOrderSingle(msg: FixMessage): FixOrderParams {
    if (msg.header.msgType !== 'D') {
      throw new Error(`Expected MsgType D (NewOrderSingle), got ${msg.header.msgType}`);
    }

    const clOrdId = msg.fields.get(11);
    const symbol = msg.fields.get(55);
    const side = msg.fields.get(54) as '1' | '2';
    const orderQty = parseFloat(msg.fields.get(38) || '0');
    const price = parseFloat(msg.fields.get(44) || '0');
    const ordType = (msg.fields.get(40) || '2') as '1' | '2';
    const timeInForce = (msg.fields.get(59) || '0') as '0' | '1' | '3';

    if (!clOrdId || !symbol || !side || orderQty <= 0) {
      throw new Error('Mandatory FIX NewOrderSingle fields missing or invalid (tags 11, 55, 54, 38)');
    }

    return {
      clOrdId,
      symbol,
      side,
      orderQty,
      price,
      ordType,
      timeInForce,
    };
  }
}
