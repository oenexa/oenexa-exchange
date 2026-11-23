import { describe, it, expect } from 'vitest';
import { FixProtocolGateway, SOH } from '../gateway/FixProtocolGateway.js';

describe('Institutional FIX 4.4 Protocol Gateway Suite', () => {
  const gateway = new FixProtocolGateway('OENEXA_EXCH', 'CITADEL_INST');

  describe('Message Serialization & Checksum Verification', () => {
    it('serializes a Logon message with calculated BodyLength and valid Checksum', () => {
      const logon = gateway.buildLogonResponse(30);

      expect(logon).toContain('8=FIX.4.4\x01');
      expect(logon).toContain('35=A\x01');
      expect(logon).toContain('49=OENEXA_EXCH\x01');
      expect(logon).toContain('56=CITADEL_INST\x01');
      expect(logon).toContain('98=0\x01');
      expect(logon).toContain('108=30\x01');
      expect(logon).toContain('141=Y\x01');
      expect(logon).toMatch(/10=\d{3}\x01$/);

      // Verify that parsing this exact serialized message succeeds without checksum errors
      const parsed = gateway.parseFixMessage(logon);
      expect(parsed.header.msgType).toBe('A');
      expect(parsed.header.senderCompId).toBe('OENEXA_EXCH');
      expect(parsed.header.targetCompId).toBe('CITADEL_INST');
    });

    it('detects and rejects messages with corrupted or tampered checksums', () => {
      const valid = gateway.buildHeartbeat('TEST_123');
      // Tamper with the checksum tag
      const tampered = valid.replace(/10=\d{3}\x01$/, '10=999\x01');

      expect(() => gateway.parseFixMessage(tampered)).toThrow(/FIX Checksum mismatch/);
    });
  });

  describe('NewOrderSingle (35=D) Ingestion & Validation', () => {
    it('parses valid limit buy order from institutional client', () => {
      // Build raw client NewOrderSingle
      const body = `35=D${SOH}49=CITADEL_INST${SOH}56=OENEXA_EXCH${SOH}34=101${SOH}52=20261124-00:30:00.000${SOH}11=ORD_INST_9918${SOH}55=BTC_USDT${SOH}54=1${SOH}38=2.5000${SOH}44=91250.0000${SOH}40=2${SOH}59=1${SOH}`;
      const head = `8=FIX.4.4${SOH}9=${body.length}${SOH}`;
      const pre = head + body;
      const chk = FixProtocolGateway.calculateChecksum(pre);
      const rawOrder = `${pre}10=${chk}${SOH}`;

      const parsedMsg = gateway.parseFixMessage(rawOrder);
      const order = gateway.parseNewOrderSingle(parsedMsg);

      expect(order.clOrdId).toBe('ORD_INST_9918');
      expect(order.symbol).toBe('BTC_USDT');
      expect(order.side).toBe('1'); // Buy
      expect(order.orderQty).toBe(2.5);
      expect(order.price).toBe(91250.0);
      expect(order.ordType).toBe('2'); // Limit
      expect(order.timeInForce).toBe('1'); // GTC
    });

    it('rejects NewOrderSingle missing mandatory tags (e.g. quantity or symbol)', () => {
      const invalidMsg = {
        header: {
          beginString: 'FIX.4.4',
          msgType: 'D',
          senderCompId: 'CITADEL_INST',
          targetCompId: 'OENEXA_EXCH',
          msgSeqNum: 102,
          sendingTime: '20261124-00:30:00',
        },
        fields: new Map<number, string>([[11, 'ORD_MALFORMED']]),
      };

      expect(() => gateway.parseNewOrderSingle(invalidMsg)).toThrow(
        /Mandatory FIX NewOrderSingle fields missing/
      );
    });
  });

  describe('ExecutionReport (35=8) Emission', () => {
    it('builds trade fill ExecutionReport matching institutional clearing standards', () => {
      const execReport = gateway.buildExecutionReport({
        orderId: 'OX_ORD_77819',
        clOrdId: 'ORD_INST_9918',
        execId: 'EXEC_881920',
        execType: 'F', // Trade
        ordStatus: '2', // Filled
        symbol: 'BTC_USDT',
        side: '1',
        orderQty: 2.5,
        price: 91250.0,
        lastQty: 2.5,
        lastPx: 91250.0,
        leavesQty: 0.0,
        cumQty: 2.5,
        avgPx: 91250.0,
        text: 'Settled via OENEXA Ultra-Low Latency Matching Engine',
      });

      expect(execReport).toContain('35=8\x01');
      expect(execReport).toContain('37=OX_ORD_77819\x01');
      expect(execReport).toContain('11=ORD_INST_9918\x01');
      expect(execReport).toContain('17=EXEC_881920\x01');
      expect(execReport).toContain('150=F\x01');
      expect(execReport).toContain('39=2\x01');
      expect(execReport).toContain('151=0\x01');
      expect(execReport).toContain('14=2.5\x01');
      expect(execReport).toContain('6=91250.0000\x01');
      expect(execReport).toContain('58=Settled via OENEXA Ultra-Low Latency Matching Engine\x01');

      // Verify parse roundtrip
      const parsed = gateway.parseFixMessage(execReport);
      expect(parsed.fields.get(150)).toBe('F');
      expect(parsed.fields.get(39)).toBe('2');
    });
  });
});
