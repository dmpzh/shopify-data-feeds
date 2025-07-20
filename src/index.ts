import { create } from 'xmlbuilder';
import { ProductData } from './types';

function generateGoogleMerchantXML(shopUrl: string, products: ProductData[]) {
	const root = create('rss', { version: '1.0' }, undefined, { keepNullNodes: false, keepNullAttributes: false })
		.att('xmlns:g', 'http://base.google.com/ns/1.0')
		.att('version', '2.0')
		.ele('channel');

	// Add <title>, <link>, <description>, etc.
	root.ele('title', 'Shopify Product Feed');
	root.ele('link', shopUrl);
	root.ele('description', 'Shopify product feed for Google Merchant Center');

	// Add each product
	const currency = '€';
	products.forEach((product) => {
		const firstVariant = product.variants[0] || {};
		const item = root.ele('item');
		item.ele('g:id', product.id);
		item.ele('title', product.title);
		item.ele('g:description', product.body_html.replace(/<[^>]*>?/gm, ''));
		item.ele('link', `${shopUrl}/products/${product.handle}`);
		item.ele('g:image_link', product.image.src);
		item.ele('g:brand', product.vendor || '');
		item.ele('g:condition', 'new');
		item.ele(
			'g:availability',
			firstVariant.inventory_policy == 'continue' || firstVariant.inventory_quantity ? 'in_stock' : 'out_of_stock'
		);
		item.ele('g:price', `${firstVariant.price} ${currency}`);

		item.ele('g:gtin', firstVariant.barcode || '');
		item.ele('g:mpn', firstVariant.sku || '');
		item.ele('g:product_type', product.product_type || '');

		const tags = product.tags.split(', ').slice(0, 5);
		tags.forEach((tag, i) => item.ele(`g:custom_label_${i + 1}`, tag));
	});

	// Convert to xml
	return root.end({ pretty: true });
}

async function getProducts(env: Env): Promise<ProductData[]> {
	// Étape 1 : Récupérer le nombre total de produits
	const countUrl = `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/2023-01/products/count.json?published_status=published`;

	const countResponse = await fetch(countUrl, {
		method: 'GET',
		headers: {
			'X-Shopify-Access-Token': env.SHOPIFY_ACCESS_TOKEN,
			'Content-Type': 'application/json',
		},
	});

	if (!countResponse.ok) {
		throw new Error('Failed to fetch product count');
	}

	const countData = (await countResponse.json()) as { count: number };
	const totalProducts = countData.count;
	console.log(`Total Products: ${totalProducts}`);

	// Étape 2 : Récupérer tous les produits en utilisant since_id pour la pagination
	const products = [];
	const limit = 250; // Shopify limite à 250 produits par requête
	let lastProductId = 0;

	while (products.length < totalProducts) {
		const productsUrl = `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/2023-01/products.json?published_status=published&limit=${limit}&since_id=${lastProductId}`;

		const response = await fetch(productsUrl, {
			method: 'GET',
			headers: {
				'X-Shopify-Access-Token': env.SHOPIFY_ACCESS_TOKEN,
				'Content-Type': 'application/json',
			},
		});

		if (!response.ok) {
			throw new Error('Failed to fetch products');
		}

		const data = (await response.json()) as { products: ProductData[] };
		if (data.products.length === 0) break; // Stop si plus de produits

		products.push(...data.products);
		lastProductId = data.products[data.products.length - 1].id; // Met à jour le dernier ID récupéré

		console.log(`Fetched ${data.products.length} products, total: ${products.length}`);
	}

	console.log(`Total fetched products: ${products.length}`);

	return products;
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const products = await getProducts(env);
		return new Response(generateGoogleMerchantXML(`https://${env.SHOPIFY_SHOP_DOMAIN}`, products));
	},
} satisfies ExportedHandler<Env>;
