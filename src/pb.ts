import PocketBase from 'pocketbase';

// Ligar ao servidor PocketBase Central
export const pb = new PocketBase('http://127.0.0.1:8090');

// Desativar autocancelamento de pedidos pendentes caso o componente recarregue rápido
pb.autoCancellation(false);
