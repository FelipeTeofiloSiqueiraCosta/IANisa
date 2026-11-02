export const HIGGSFIELD={
 key:'higgsfield',name:'Higgsfield',url:'https://mcp.higgsfield.ai/mcp',
 resourceMetadataUrl:'https://mcp.higgsfield.ai/.well-known/oauth-protected-resource/mcp',
 issuer:'https://clerk.higgsfield.ai',scope:'openid email offline_access',
 authorizationOrigin:'https://clerk.higgsfield.ai',allowedOrigins:['https://mcp.higgsfield.ai','https://clerk.higgsfield.ai'],
};
export const META_ADS={
 key:'meta-ads',name:'Meta Ads',url:'https://mcp.facebook.com/ads',
 resourceMetadataUrl:'https://mcp.facebook.com/.well-known/oauth-protected-resource/ads',
 issuer:'https://www.facebook.com/ads',authorizationOrigin:'https://www.facebook.com',
 allowedOrigins:['https://mcp.facebook.com','https://www.facebook.com','https://graph.facebook.com'],
 scope:'ads_management ads_read catalog_management business_management pages_show_list pages_manage_ads facebook_branded_content_ads_brand instagram_basic instagram_branded_content_ads_brand ads_mcp_management',
 requiresClientId:true,
};
export const OAUTH_CONNECTORS=[HIGGSFIELD,META_ADS];
export const oauthConnector=key=>OAUTH_CONNECTORS.find(p=>p.key===key);
