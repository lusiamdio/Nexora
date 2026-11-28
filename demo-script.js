import 'dotenv/config';

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY?.trim();

if (!ALCHEMY_API_KEY) {
  console.error(
    'Missing ALCHEMY_API_KEY. Create a .env file in the project root with:\n\n  ALCHEMY_API_KEY=<my-key>\n\nThen run: node demo-script.js'
  );
  process.exit(1);
}

const DEFAULT_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const targetAddress = (process.argv[2] || DEFAULT_ADDRESS).trim();

if (!/^0x[a-fA-F0-9]{40}$/.test(targetAddress)) {
  console.error('Invalid Ethereum address. Usage: node demo-script.js <0xAddress>');
  process.exit(1);
}

const RPC_ENDPOINT = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
const NFT_REST_BASE = `https://eth-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_API_KEY}`;

async function callAlchemyRpc(method, params) {
  const response = await fetch(RPC_ENDPOINT, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`Alchemy RPC error (${response.status}) while calling ${method}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`Alchemy RPC returned error for ${method}: ${data.error.message || 'Unknown error'}`);
  }
  return data.result;
}

async function runDemo() {
  console.log(`\nAlchemy Ethereum Mainnet API Demo for address: ${targetAddress}\n`);

  // 0. Core JSON-RPC Check: Latest Block Number
  const hexBlockNumber = await callAlchemyRpc('eth_blockNumber', []);
  console.log('0) Core JSON-RPC (eth_blockNumber):', {
    hex: hexBlockNumber,
    decimal: Number.parseInt(hexBlockNumber, 16),
  });

  // 1. Transfers API: alchemy_getAssetTransfers
  const transfersResult = await callAlchemyRpc('alchemy_getAssetTransfers', [
    {
      fromBlock: '0x0',
      toBlock: 'latest',
      toAddress: targetAddress,
      category: ['external', 'erc20', 'erc721', 'erc1155'],
      withMetadata: true,
      excludeZeroValue: true,
      maxCount: '0x3',
      order: 'desc',
    },
  ]);

  const transfers = Array.isArray(transfersResult?.transfers) ? transfersResult.transfers : [];
  console.log('\n1) Transfers API (alchemy_getAssetTransfers) — Latest 3 incoming transfers:');
  console.log(
    JSON.stringify(
      transfers.map((tx) => ({
        blockNum: tx.blockNum,
        hash: tx.hash,
        category: tx.category,
        asset: tx.asset,
        value: tx.value,
        from: tx.from,
        to: tx.to,
        timestamp: tx.metadata?.blockTimestamp || null,
      })),
      null,
      2
    )
  );

  // 2. Token API: alchemy_getTokenBalances + alchemy_getTokenMetadata
  const balancesResult = await callAlchemyRpc('alchemy_getTokenBalances', [targetAddress, 'erc20']);
  const nonZeroBalances = (balancesResult?.tokenBalances || [])
    .filter((tb) => tb.tokenBalance && !/^0x0+$/.test(tb.tokenBalance))
    .slice(0, 3);

  const enrichedTokens = await Promise.all(
    nonZeroBalances.map(async (tb) => {
      const metadata = await callAlchemyRpc('alchemy_getTokenMetadata', [tb.contractAddress]).catch(() => null);
      const decimals = typeof metadata?.decimals === 'number' ? metadata.decimals : 18;
      const rawAmount = BigInt(tb.tokenBalance);
      const divisor = 10n ** BigInt(decimals);
      const whole = rawAmount / divisor;
      const frac = ((rawAmount % divisor) * 10000n) / divisor;
      return {
        contractAddress: tb.contractAddress,
        symbol: metadata?.symbol || 'UNKNOWN',
        name: metadata?.name || 'Unknown Token',
        decimals,
        rawHexBalance: tb.tokenBalance,
        formattedBalance: `${whole}.${frac.toString().padStart(4, '0')}`,
      };
    })
  );

  console.log('\n2) Token API (alchemy_getTokenBalances + alchemy_getTokenMetadata) — Sample non-zero ERC-20 tokens:');
  console.log(JSON.stringify(enrichedTokens, null, 2));

  // 3. NFT API v3: GET /nft/v3/$ALCHEMY_API_KEY/getNFTsForOwner
  const nftUrl = new URL(`${NFT_REST_BASE}/getNFTsForOwner`);
  nftUrl.searchParams.set('owner', targetAddress);
  nftUrl.searchParams.set('withMetadata', 'true');
  nftUrl.searchParams.set('pageSize', '3');

  const nftResponse = await fetch(nftUrl.toString(), {
    method: 'GET',
    headers: { accept: 'application/json' },
  });

  if (!nftResponse.ok) {
    throw new Error(`Alchemy NFT API error (${nftResponse.status})`);
  }

  const nftData = await nftResponse.json();
  const ownedNfts = Array.isArray(nftData?.ownedNfts) ? nftData.ownedNfts : [];
  console.log('\n3) NFT API v3 (getNFTsForOwner) — Summary:');
  console.log(
    JSON.stringify(
      {
        totalCount: nftData?.totalCount ?? ownedNfts.length,
        validAtBlock: nftData?.validAt?.blockNumber ?? null,
        sampleNfts: ownedNfts.map((nft) => ({
          contractAddress: nft.contract?.address,
          collectionName: nft.contract?.name || nft.contract?.openSeaMetadata?.collectionName || null,
          tokenType: nft.tokenType,
          tokenId: nft.tokenId,
          name: nft.name || null,
        })),
      },
      null,
      2
    )
  );
}

runDemo().catch((err) => {
  console.error('Demo execution failed:', err.message);
  process.exit(1);
});
