import PocketBase from 'pocketbase';

const pbBaseUrl =
  typeof window !== 'undefined' &&
  window.location.hostname !== 'localhost' &&
  window.location.hostname !== '127.0.0.1'
    ? window.location.origin
    : 'http://127.0.0.1:8090';

// Ligar ao servidor PocketBase Central (Cloud Origin ou Local :8090)
export const pb = new PocketBase(pbBaseUrl);

// Desativar autocancelamento de pedidos pendentes caso o componente recarregue rápido
pb.autoCancellation(false);
