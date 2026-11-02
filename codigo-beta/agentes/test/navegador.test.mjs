import {test} from 'node:test';
import assert from 'node:assert/strict';
import {conexoes} from '../navegador.mjs';

// /proc/net/tcp: local_address rem_address st (01 = ESTABLISHED, 0A = LISTEN)
const tabela = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:8DDF 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1002        0 1
   1: 0100007F:8DDF 0100007F:B1C2 01 00000000:00000000 00:00000000 00000000  1002        0 2
   2: 0100007F:B1C2 0100007F:8DDF 01 00000000:00000000 00:00000000 00000000  1002        0 3
   3: 0100007F:1F90 0100007F:C000 01 00000000:00000000 00:00000000 00000000  1002        0 4`;

test('conta só as conexões abertas na porta do navegador, do lado de quem escuta', () => {
  assert.equal(conexoes(tabela, 0x8DDF), 1);   // a linha 2 é o cliente (porta remota), não conta
  assert.equal(conexoes(tabela, 0x1F90), 1);
  assert.equal(conexoes(tabela, 0x1234), 0);
  assert.equal(conexoes('', 0x8DDF), 0);
});
