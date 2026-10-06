/* ============================================================
   LinguaPulse — real-time conversation translator + coach
   ------------------------------------------------------------
   Pipeline per turn:
     mic -> SpeechRecognition -> commit on silence
        -> translate (MyMemory | OpenAI-compatible)
        -> coach feedback written in the TARGET language
        -> speak translation via speechSynthesis
        -> (turn-taking) flip to the other speaker
   ============================================================ */

/* ------------------------- languages ------------------------- */
const LANGS = [
  { code:'en-US', base:'en',    label:'English',    flag:'🇬🇧' },
  { code:'es-ES', base:'es',    label:'Spanish',    flag:'🇪🇸' },
  { code:'fr-FR', base:'fr',    label:'French',     flag:'🇫🇷' },
  { code:'de-DE', base:'de',    label:'German',     flag:'🇩🇪' },
  { code:'it-IT', base:'it',    label:'Italian',    flag:'🇮🇹' },
  { code:'pt-BR', base:'pt',    label:'Portuguese', flag:'🇧🇷' },
  { code:'zh-CN', base:'zh-CN', label:'Chinese',    flag:'🇨🇳' },
  { code:'ja-JP', base:'ja',    label:'Japanese',   flag:'🇯🇵' },
  { code:'ko-KR', base:'ko',    label:'Korean',     flag:'🇰🇷' },
  { code:'ru-RU', base:'ru',    label:'Russian',    flag:'🇷🇺' },
  { code:'ar-SA', base:'ar',    label:'Arabic',     flag:'🇸🇦' },
  { code:'hi-IN', base:'hi',    label:'Hindi',      flag:'🇮🇳' },
  { code:'nl-NL', base:'nl',    label:'Dutch',      flag:'🇳🇱' },
  { code:'pl-PL', base:'pl',    label:'Polish',     flag:'🇵🇱' },
  { code:'tr-TR', base:'tr',    label:'Turkish',    flag:'🇹🇷' },
  { code:'sv-SE', base:'sv',    label:'Swedish',    flag:'🇸🇪' },
  { code:'id-ID', base:'id',    label:'Indonesian', flag:'🇮🇩' },
  { code:'th-TH', base:'th',    label:'Thai',       flag:'🇹🇭' },
  { code:'vi-VN', base:'vi',    label:'Vietnamese', flag:'🇻🇳' },
  { code:'he-IL', base:'he',    label:'Hebrew',     flag:'🇮🇱' },
  { code:'el-GR', base:'el',    label:'Greek',      flag:'🇬🇷' },
  { code:'cs-CZ', base:'cs',    label:'Czech',      flag:'🇨🇿' },
  { code:'da-DK', base:'da',    label:'Danish',     flag:'🇩🇰' },
  { code:'fi-FI', base:'fi',    label:'Finnish',    flag:'🇫🇮' },
  { code:'nb-NO', base:'no',    label:'Norwegian',  flag:'🇳🇴' },
  { code:'uk-UA', base:'uk',    label:'Ukrainian',  flag:'🇺🇦' },
  { code:'ro-RO', base:'ro',    label:'Romanian',   flag:'🇷🇴' },
  { code:'hu-HU', base:'hu',    label:'Hungarian',  flag:'🇭🇺' },
  { code:'fil-PH',base:'tl',    label:'Filipino',   flag:'🇵🇭' },
  { code:'bn-IN', base:'bn',    label:'Bengali',    flag:'🇧🇩' },
  { code:'ta-IN', base:'ta',    label:'Tamil',      flag:'🇮🇳' },
  { code:'fa-IR', base:'fa',    label:'Persian',    flag:'🇮🇷' },
  { code:'ur-PK', base:'ur',    label:'Urdu',       flag:'🇵🇰' },
  { code:'zh-TW', base:'zh-TW', label:'Chinese (Traditional)', flag:'🇹🇼' },
  { code:'sk-SK', base:'sk', label:'Slovak',     flag:'🇸🇰' },
  { code:'hr-HR', base:'hr', label:'Croatian',   flag:'🇭🇷' },
  { code:'sl-SI', base:'sl', label:'Slovenian',  flag:'🇸🇮' },
  { code:'sr-RS', base:'sr', label:'Serbian',    flag:'🇷🇸' },
  { code:'bg-BG', base:'bg', label:'Bulgarian',  flag:'🇧🇬' },
  { code:'mk-MK', base:'mk', label:'Macedonian', flag:'🇲🇰' },
  { code:'lt-LT', base:'lt', label:'Lithuanian', flag:'🇱🇹' },
  { code:'lv-LV', base:'lv', label:'Latvian',    flag:'🇱🇻' },
  { code:'et-EE', base:'et', label:'Estonian',   flag:'🇪🇪' },
  { code:'ca-ES', base:'ca', label:'Catalan',    flag:'🇦🇩' },
  { code:'ms-MY', base:'ms', label:'Malay',      flag:'🇲🇾' },
  { code:'sw-KE', base:'sw', label:'Swahili',    flag:'🇰🇪' },
  { code:'af-ZA', base:'af', label:'Afrikaans',  flag:'🇿🇦' },
  { code:'eu-ES', base:'eu', label:'Basque',     flag:'🇪🇸' },
];
const PROVIDERS = ['google','apple','github','discord','passkey'];
const langByCode = c => LANGS.find(l => l.code === c) || LANGS[0];
const AUTO = { code:'auto', base:'auto', label:'Auto-detect', flag:'🌐' };
function langMeta(code){ return code === 'auto' ? AUTO : langByCode(code); }

// remembers the last detected language per speaker so the recognition hint improves over time
const lastDetected = { A:'en-US', B:'en-US' };
function recogLangHint(slot){
  const code = slot === 'A' ? S.langA : S.langB;
  if(code && code !== 'auto') return code;
  return lastDetected[slot] || 'en-US';
}

// ----------------------------------------------------------------
//  Source-language detection — layered, runs offline (no API key):
//   1) script detection (covers CJK, Cyrillic, Arabic/Persian/Urdu, Devanagari, Thai, Hebrew, Bengali, Tamil)
//   2) unique diacritic / digraph fingerprints (high precision for vi/pl/cs/tr/es/pt/sv/nl)
//   3) distinctive-word scoring
//   4) letter-frequency cosine as a tie-break
//  When an OpenAI-compatible key is configured, detectLangLLM() is used instead for best accuracy.
// ----------------------------------------------------------------
const SCRIPT_RE = [
  [/[ぁ-んァ-ヶ]/, 'ja-JP'],
  [/[가-힣]/, 'ko-KR'],
  [/[ก-๛]/, 'th-TH'],
  [/[ঀ-৿]/, 'bn-IN'],
  [/[஀-௿]/, 'ta-IN'],
  [/[Ѐ-ӿ]/, null],   // Cyrillic → disambiguated below (ru / bg / mk / sr)
  [/[ऀ-ॿ]/, 'hi-IN'],
  [/[א-ת]/, 'he-IL'],
  [/[؀-ۿ]/, null],   // Arabic script → disambiguated below (ar / fa / ur)
  [/[一-鿿]/, 'zh-CN'],
];
// high-precision markers — only letters that are essentially unique to one language in our set.
// (kept tight on purpose: vi uses ơ/ư/đ, pl uses ł + Polish hooks, cs uses ř/ů, tr uses ş/ğ, etc.
//  Portuguese has no exclusive diacritic — it is detected by its WORDS list instead.)
const UNIQ = [
  ['vi-VN', /[ơưđ]/i],                       // ơ, ư, đ are Vietnamese-only
  ['pl-PL', /[łśćńżźęą]/i],                 // ł and Polish hooks → very high precision (ó excluded: shared with hu/es/it)
  ['cs-CZ', /[řů]/i],                         // ř,ů Czech-only
  ['tr-TR', /[şğ]/i],                         // ş,ğ Turkish-only
  ['es-ES', /[ñ]/i],                          // ñ Spanish-only
  ['nl-NL', /ij/i],                           // Dutch ij digraph
  ['bg-BG', /[ъЪ]/i],                         // ъ (er goljam) is Bulgarian-only
  ['mk-MK', /[ќѓЌЃ]/i],                       // ќ,ѓ are Macedonian-only
  ['sk-SK', /[ľťďňôäŕĽŤĎŇ]/i],               // ľ,ť,ď,ň,ô,ä,ŕ Slovak-only (vs Czech ř/ů)
  ['lt-LT', /[ąęėįųūĄĘĖĮŲŪ]/i],              // nasal/long vowels → Lithuanian
  ['lv-LV', /[āēīģķļņĀĒĪĢĶĻŅ]/i],           // ģ,ķ,ļ,ņ + long vowels → Latvian
  ['et-EE', /[õÕ]/i],                         // õ is Estonian-only (Finnish lacks it)
];
const WORDS = {
  'en-US':['the','you','hello','what','today','my','name','thanks','yes','good','how','are','have','we','do','i','to','and','it','of'],
  'es-ES':['hola','cómo','qué','está','gracias','por','yo','tu','hoy','muy','bien','si','no','con','pero','soy','eres','buenos','días'],
  'fr-FR':['bonjour','merci','oui','donc','très','aussi','chez','avec','pour','vous','nous','être','avoir','jamais','toujours','comment','je','tu','et','est'],
  'de-DE':['der','die','und','hallo','wie','danke','ein','nicht','sind','geht','guten','tag','mich','mir','wir','auch','noch','bin','schön','das','ich','du'],
  'it-IT':['è','sono','ciao','grazie','io','non','molto','bene','per','che','prego','allora','perché','anche','questo','quello','sempre','buongiorno','giorno','modo'],
  'pt-BR':['você','olá','obrigado','não','sim','está','muito','bem','com','por','bom','dia','vocês','também','agora','aqui'],
  'nl-NL':['het','ik','je','hallo','hoe','dank','niet','bent','met','zeer','goed','van','wat','mijn','ook','ja','wij','jij','hebben','nog'],
  'pl-PL':['jest','ja','ty','cześć','jak','dzięki','nie','tak','jestem','bardzo','dobrze','dzień','się','na','z','do','to','proszę','czy'],
  'tr-TR':['bu','ve','ben','sen','merhaba','nasıl','teşekkür','var','iyi','çok','gün','ile','evet','hayır','benim','bir'],
  'sv-SE':['och','är','jag','du','hej','hur','tack','ett','inte','vi','det','med','för','ja','bra','dag','mycket','träffa','att','hejdå','imorgon','morgon'],
  'id-ID':['dan','saya','kamu','halo','bagaimana','terima','kasih','ini','tidak','ya','apa','sangat','baik','dengan','untuk','selamat','kami','kita'],
  'vi-VN':['và','tôi','bạn','xin','chào','cảm','ơn','không','có','là','người','rất','tốt','với','của','này','anh','em'],
  'cs-CZ':['já','ty','ahoj','jak','děkuji','ne','ano','to','jsi','velmi','dobře','jsem','s','na','prosím','den','česky'],
  'da-DK':['og','er','jeg','du','hej','hvordan','tak','en','ikke','vi','det','godt','meget','med','for','ja','dag','også','hedder','dig','møde'],
  'fi-FI':['on','minä','sinä','hei','miten','kiitos','ei','kyllä','tämä','olen','hyvä','ole','ja','s','että','päivä'],
  'no-NO':['og','er','jeg','du','hei','hvordan','takk','en','ikke','vi','det','godt','vel','veldig','med','for','ja','dag','også','heter','deg','møte','møtes'],
  'ro-RO':['și','este','eu','tu','salut','cum','mulțumesc','nu','da','acest','sunt','bine','cu','pentru','zi','foarte'],
  'hu-HU':['és','van','én','te','szia','hogy','köszönöm','nem','igen','ez','vagyok','jól','meg','is','nagyon','nap','magyar'],
  'fil-PH':['ako','ikaw','kumusta','salamat','hindi','oo','ito','nga','ka','magandang','ang','sa','ng','pa','ay'],
  'sk-SK':['a','som','je','ty','ahoj','ako','ďakujem','nie','áno','to','sme','veľmi','dobre','deň','s','na','prosím','veľa','rád','v','pre','jeho','slovensky'],
  'hr-HR':['i','ja','ti','bok','kako','hvala','ne','da','ovo','jako','dobro','dan','s','na','molim','vrlo','lijepo','što','je','v','za','osobno','hrvatski'],
  'sl-SI':['in','sem','ti','živjo','kako','hvala','ne','da','to','zelo','dobro','dan','s','na','prosim','zelo','lepo','kaj','je','v','za','osebno','slovensko'],
  'sr-RS':['i','ja','ti','zdravo','kako','hvala','ne','da','ovo','jako','dobro','dan','s','na','molim','veoma','lepo','šta','je','u','za','lično','srpski'],
  'bg-BG':['и','аз','ти','здравей','как','благодаря','не','да','това','много','добре','ден','с','на','моля','хубаво','какво','е','в','за','лично','български'],
  'mk-MK':['и','јас','ти','здраво','како','благодарам','не','да','ова','многу','добро','ден','со','на','те молам','убаво','што','е','во','за','лично','македонски'],
  'lt-LT':['ir','aš','tu','labas','kaip','ačiū','ne','taip','tai','labai','gerai','diena','su','ką','prašau','gražu','kas','yra','i','už','asmeniškai','lietuviškai'],
  'lv-LV':['un','es','tu','sveiks','kā','paldies','nē','jā','tas','ļoti','labi','diena','ar','ko','lūdzu','skaisti','kas','ir','uz','personīgi','latviski'],
  'et-EE':['ja','mina','sina','tere','kuidas','aitäh','ei','jah','see','väga','hästi','päev','mis','palun','ilus','on','et','isiklik','eesti'],
  'ca-ES':['i','jo','tu','hola','com','gràcies','no','sí','això','molt','bé','dia','amb','què','si us plau','bell','què','és','a','per','personal','català'],
  'ms-MY':['dan','saya','awak','hello','macam','terima','kasih','ini','tidak','ya','apa','sangat','baik','dengan','untuk','selamat','kami','kita','adalah','di','ke','peribadi','melayu'],
  'sw-KE':['na','mimi','wewe','hujambo','habari','asante','hapana','ndiyo','hii','sana','vizuri','siku','nini','tafadhali','zuri','ni','kwa','binafsi','kiswahili'],
  'af-ZA':['en','ek','jy','hallo','hoe','dankie','nee','ja','dit','baie','goed','dag','met','wat','asseblief','mooi','is','in','vir','persoonlik','afrikaans'],
  'eu-ES':['eta','ni','zu','kaixo','nola','eskerrik','ez','bai','hau','oso','ondo','egun','rekin','zer','mesedez','polit','da','an','rako','pertsonal','euskara'],
};
// compact letter-frequency profiles (per 100 letters) for the Latin-script languages
const LATIN_PROF = {
  'en-US':{a:8.2,b:1.5,c:2.8,d:4.3,e:12.7,f:2.2,g:2.0,h:6.1,i:7.0,j:0.2,k:0.8,l:4.0,m:2.4,n:6.7,o:7.5,p:1.9,q:0.1,r:6.0,s:6.3,t:9.1,u:2.8,v:1.0,w:1.8,x:0.2,y:2.0,z:0.1},
  'es-ES':{a:12.5,b:1.4,c:4.7,d:5.9,e:13.7,f:0.7,g:1.0,h:0.7,i:6.3,j:0.5,k:0.1,l:5.8,m:3.1,n:7.0,o:8.7,p:3.1,q:1.0,r:6.9,s:7.9,t:4.6,u:4.6,v:1.1,w:0.1,x:0.1,y:0.7,z:0.4},
  'fr-FR':{a:7.6,b:0.9,c:3.4,d:3.7,e:14.7,f:1.1,g:1.1,h:0.8,i:7.5,j:0.6,k:0.1,l:5.5,m:2.6,n:7.1,o:6.3,p:2.9,q:1.4,r:8.0,s:7.9,t:7.2,u:6.3,v:1.6,w:0.1,x:0.4,y:0.3,z:0.3},
  'de-DE':{a:6.5,b:1.9,c:3.1,d:5.1,e:16.4,f:1.7,g:3.0,h:4.1,i:7.6,j:0.3,k:1.5,l:4.1,m:2.8,n:9.8,o:2.6,p:0.7,q:0.1,r:7.4,s:6.7,t:6.5,u:4.4,v:0.9,w:1.4,x:0.1,y:0.1,z:1.1},
  'it-IT':{a:11.7,b:0.9,c:4.5,d:3.8,e:11.8,f:1.1,g:1.7,h:0.6,i:11.9,j:0.1,k:0.1,l:6.5,m:2.9,n:6.9,o:9.8,p:3.0,q:0.5,r:6.4,s:5.0,t:5.7,u:3.6,v:1.5,w:0.1,x:0.1,y:0.1,z:1.1},
  'pt-BR':{a:14.6,b:1.0,c:5.0,d:4.9,e:12.5,f:1.0,g:1.2,h:1.2,i:6.5,j:0.4,k:0.1,l:3.3,m:1.9,n:5.4,o:10.7,p:3.0,q:0.6,r:6.5,s:7.8,t:4.3,u:4.6,v:1.6,w:0.1,x:0.1,y:0.1,z:0.3},
  'nl-NL':{a:7.5,b:1.8,c:1.4,d:5.9,e:14.5,f:0.8,g:3.4,h:2.3,i:6.6,j:1.8,k:2.3,l:3.6,m:2.3,n:10.1,o:6.4,p:1.9,q:0.1,r:6.8,s:3.7,t:6.7,u:2.0,v:2.7,w:1.5,x:0.1,y:0.1,z:1.3},
  'pl-PL':{a:9.5,b:1.6,c:4.0,d:3.5,e:8.7,f:0.3,g:1.5,h:1.1,i:9.0,j:2.2,k:3.2,l:3.4,m:3.0,n:7.9,o:7.0,p:2.5,q:0.1,r:4.8,s:4.6,t:2.8,u:2.2,v:0.1,w:4.5,y:3.8,z:5.0},
  'tr-TR':{a:12.0,b:2.3,c:1.0,d:4.5,e:9.8,f:0.4,g:1.2,h:1.3,i:9.0,j:0.1,k:6.5,l:6.0,m:3.6,n:7.5,o:2.7,p:1.0,q:0.1,r:7.0,s:3.6,t:3.4,u:3.7,v:1.0,w:0.1,x:0.1,y:2.0,z:1.5},
  'sv-SE':{a:9.3,b:1.5,c:1.5,d:4.6,e:10.1,f:2.0,g:3.1,h:2.2,i:5.9,j:1.0,k:3.3,l:5.3,m:3.4,n:8.6,o:4.0,p:1.8,q:0.1,r:8.5,s:6.4,t:8.0,u:1.4,v:2.3,w:0.1,x:0.1,y:0.5,z:1.3},
  'id-ID':{a:16.0,b:2.0,c:3.0,d:3.5,e:8.0,f:2.0,g:2.0,h:2.0,i:7.0,j:2.0,k:3.0,l:4.0,m:3.0,n:7.0,o:6.0,p:2.0,q:1.0,r:8.0,s:5.0,t:5.0,u:4.0,v:1.0,w:1.0,x:0.5,y:1.5,z:1.0},
  'vi-VN':{a:14.0,b:2.0,c:2.0,d:4.0,e:10.0,f:2.0,g:2.0,h:2.0,i:7.0,j:0.5,k:1.0,l:3.0,m:3.0,n:6.0,o:3.0,p:2.0,q:0.5,r:4.0,s:4.0,t:4.0,u:4.0,v:1.0,x:0.5,y:1.5,z:0.5},
  'cs-CZ':{a:10.0,b:1.5,c:1.5,d:3.5,e:9.0,f:0.5,g:1.5,h:1.5,i:6.0,j:1.5,k:3.0,l:4.0,m:3.0,n:7.0,o:7.0,p:2.0,q:0.1,r:5.0,s:6.0,t:5.0,u:2.0,v:3.0,w:1.0,x:0.1,y:1.0,z:1.5},
  'ro-RO':{a:9.0,b:1.0,c:2.5,d:3.5,e:9.5,f:0.5,g:1.0,h:1.5,i:4.5,j:0.5,k:1.5,l:3.5,m:2.5,n:6.5,o:4.5,p:1.5,q:0.1,r:5.5,s:4.5,t:4.5,u:2.5,v:1.0,w:0.5,x:0.1,y:1.0,z:0.5},
  'hu-HU':{a:10.0,b:1.5,c:1.0,d:2.5,e:8.5,f:1.0,g:2.0,h:2.0,i:4.5,j:1.0,k:4.5,l:3.5,m:2.5,n:4.0,o:3.5,p:2.5,q:0.1,r:3.5,s:4.5,t:4.0,u:1.5,v:1.5,w:0.5,x:0.1,y:1.5,z:1.5},
  'fil-PH':{a:12.0,b:2.5,c:2.5,d:2.5,e:7.5,f:2.0,g:2.0,h:2.0,i:7.0,j:3.5,k:3.0,l:4.0,m:3.5,n:6.5,o:5.0,p:3.0,q:0.5,r:6.5,s:5.5,t:5.5,u:4.0,v:2.0,w:1.5,x:0.1,y:1.0,z:0.5},
  'da-DK':{a:6.8,b:2.0,c:2.4,d:5.3,e:15.3,f:2.2,g:3.8,h:3.4,i:5.6,j:1.9,k:3.2,l:4.8,m:3.2,n:7.2,o:6.8,p:1.8,q:0.1,r:8.6,s:5.8,t:6.8,u:3.4,v:3.2,w:0.9,x:0.1,y:0.2,z:0.5},
  'fi-FI':{a:10.6,b:0.6,c:1.6,d:2.8,e:6.5,f:0.6,g:2.3,h:1.5,i:9.3,j:2.3,k:4.3,l:5.6,m:2.9,n:7.8,o:5.3,p:1.6,q:0.1,r:2.8,s:6.9,t:7.6,u:3.7,v:2.1,w:0.1,x:0.0,y:0.5,z:0.3},
  'no-NO':{a:8.6,b:1.6,c:2.4,d:4.6,e:9.2,f:1.6,g:3.0,h:2.4,i:6.6,j:1.8,k:3.5,l:4.8,m:3.2,n:7.9,o:8.2,p:1.8,q:0.1,r:8.4,s:6.1,t:6.8,u:3.6,v:2.4,w:0.1,x:0.1,y:0.2,z:0.3},
  'sk-SK':{a:11.0,b:1.7,c:2.3,d:3.6,e:9.5,f:0.4,g:1.8,h:1.5,i:7.2,j:2.1,k:3.6,l:4.0,m:3.2,n:6.5,o:7.8,p:2.4,q:0.1,r:5.2,s:5.0,t:4.8,u:2.6,v:3.2,w:1.0,x:0.1,y:1.2,z:1.1},
  'hr-HR':{a:10.5,b:1.6,c:2.0,d:3.4,e:11.0,f:0.5,g:1.6,h:2.4,i:8.0,j:1.4,k:3.0,l:4.6,m:3.0,n:5.5,o:7.2,p:2.4,q:0.2,r:4.6,s:4.4,t:3.8,u:3.2,v:2.0,w:0.3,x:0.1,y:1.0,z:1.6},
  'sl-SI':{a:9.5,b:1.8,c:1.6,d:3.6,e:12.5,f:0.4,g:1.7,h:2.6,i:8.8,j:3.2,k:3.0,l:5.0,m:3.2,n:5.8,o:7.2,p:1.8,q:0.1,r:4.8,s:6.0,t:4.6,u:2.0,v:2.4,w:0.2,x:0.1,y:0.6,z:1.4},
  'sr-RS':{a:10.8,b:1.5,c:1.8,d:4.0,e:11.5,f:0.5,g:1.6,h:2.2,i:7.8,j:2.2,k:3.4,l:4.4,m:3.0,n:5.2,o:8.0,p:2.6,q:0.1,r:4.4,s:4.6,t:3.4,u:3.6,v:1.8,w:0.6,x:0.1,y:1.2,z:1.4},
  'lt-LT':{a:12.0,b:1.4,c:2.6,d:3.4,e:8.5,f:0.3,g:1.2,h:1.0,i:7.5,j:1.8,k:3.4,l:3.8,m:3.4,n:5.6,o:6.8,p:2.4,q:0.1,r:4.6,s:4.2,t:7.0,u:3.2,v:1.0,w:0.4,x:0.1,y:2.0,z:0.8},
  'lv-LV':{a:10.5,b:1.4,c:2.4,d:2.6,e:9.0,f:0.4,g:1.4,h:1.2,i:7.2,j:1.6,k:2.8,l:3.6,m:3.0,n:5.4,o:7.0,p:2.2,q:0.1,r:4.2,s:4.6,t:6.4,u:2.6,v:1.2,w:0.3,x:0.1,y:1.6,z:0.7},
  'et-EE':{a:11.0,b:1.2,c:2.0,d:2.2,e:8.5,f:0.5,g:1.4,h:1.4,i:8.5,j:2.0,k:3.0,l:2.8,m:2.8,n:6.0,o:6.4,p:2.4,q:0.1,r:4.0,s:5.6,t:6.0,u:3.0,v:1.2,w:0.3,x:0.1,y:2.4,z:0.6},
  'ca-ES':{a:11.5,b:1.6,c:3.8,d:4.0,e:13.0,f:0.8,g:1.8,h:0.8,i:7.5,j:1.2,k:0.4,l:4.8,m:3.0,n:6.2,o:8.5,p:2.8,q:0.8,r:6.6,s:7.5,t:7.5,u:3.0,v:1.0,w:0.1,x:0.2,y:0.4,z:0.3},
  'ms-MY':{a:14.0,b:2.0,c:3.5,d:3.0,e:7.5,f:1.5,g:2.0,h:2.0,i:6.5,j:2.5,k:2.5,l:4.5,m:3.5,n:7.5,o:7.0,p:2.0,q:0.5,r:7.5,s:4.5,t:5.5,u:4.5,v:1.0,w:1.0,x:0.5,y:1.0,z:0.5},
  'sw-KE':{a:12.0,b:3.0,c:3.5,d:2.5,e:8.5,f:1.5,g:2.0,h:2.0,i:6.5,j:3.0,k:3.5,l:3.0,m:4.0,n:7.0,o:6.5,p:2.5,q:0.5,r:3.5,s:4.0,t:4.5,u:3.5,v:1.5,w:1.0,x:0.5,y:1.0,z:0.5},
  'af-ZA':{a:8.5,b:1.7,c:2.4,d:4.2,e:12.5,f:1.8,g:2.8,h:1.8,i:6.5,j:1.6,k:2.2,l:4.6,m:2.6,n:8.5,o:6.8,p:1.6,q:0.1,r:6.8,s:5.6,t:6.6,u:2.6,v:2.4,w:1.4,x:0.1,y:0.2,z:0.8},
};
function letterScore(text){
  const counts = {}; let total = 0;
  for(const ch of text){
    // fold diacritics to their base Latin letter (é→e, ś→s, ñ→n, …) so frequency profiles apply
    const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if(base >= 'a' && base <= 'z'){ counts[base] = (counts[base] || 0) + 1; total++; }
  }
  if(!total) return {};
  const out = {};
  for(const code in LATIN_PROF){
    let s = 0; const p = LATIN_PROF[code];
    for(const ch in counts){ if(p[ch] != null) s += counts[ch] * p[ch]; }
    out[code] = s / total;
  }
  return out;
}
function detectLang(text){
  const t = (text || '').trim();
  if(!t) return 'en-US';
  for(const [re, code] of SCRIPT_RE){
    if(re.test(t)){
      if(code) return code;
      // Arabic-script block → disambiguate Persian / Urdu / Arabic
      if(/[ٹڈڑےں]/.test(t)) return 'ur-PK';   // Urdu-specific letters (never in Arabic/Persian)
      if(/[گژ]/.test(t)) return 'fa-IR';       // Persian gaf/zhe (never in Urdu/Arabic)
      if(/[ہ]/.test(t)) return 'ur-PK';        // Urdu he (U+06C1) vs Arabic/Persian he (U+0647)
      const arToks = t.replace(/[^؀-ۿ\s]/g, ' ').split(/\s+/).filter(Boolean);
      if(['است','من','با','شما','که','را','این','آن','برای','خانه','ممنون','خداحافظ','روز','خوب'].some(w => arToks.includes(w))) return 'fa-IR';
      return 'ar-SA';
    }
    // Cyrillic block → disambiguate (Russian is the default fallthrough)
    if(/[ъЪ]/.test(t)) return 'bg-BG';                 // ъ → Bulgarian
    if(/[ќѓЌЃ]/.test(t)) return 'mk-MK';               // ќ,ѓ → Macedonian
    if(/[ћђџљњЋЂЏЉЊ]/.test(t)) return 'sr-RS';       // Serbian-Cyrillic-only letters
    return 'ru-RU';
  }
  for(const [code, re] of UNIQ){ if(re.test(t)) return code; }
  const words = t.toLowerCase().split(/[^\p{L}]/u);   // any Unicode letter (keeps pl/cs/vi diacritic words intact)
  const lf = letterScore(t);
  let best = 'en-US', bestScore = -1;
  const codes = new Set([...Object.keys(WORDS), ...Object.keys(LATIN_PROF)]);
  for(const code of codes){
    let s = 0;
    const wl = WORDS[code];
    if(wl) for(const w of wl) if(words.includes(w)) s += 2;
    s += (lf[code] || 0) * 0.6;
    if(s > bestScore){ bestScore = s; best = code; }
  }
  return best;
}
async function detectLangLLM(text){
  try{
    const prompt = `Identify the ISO language code of this text from this exact list only: en-US, es-ES, fr-FR, de-DE, it-IT, pt-BR, nl-NL, pl-PL, tr-TR, sv-SE, id-ID, vi-VN, cs-CZ, ro-RO, hu-HU, fil-PH, ru-RU, uk-UA, ar-SA, fa-IR, ur-PK, hi-IN, bn-IN, ta-IN, ja-JP, ko-KR, zh-CN, th-TH, he-IL. Reply with ONLY the code, no explanation.`;
    const c = (await llmChat([{ role:'system', content:'You are a precise language identifier.' }, { role:'user', content: prompt + '\n\n"""' + text + '"""' }], 0)).trim();
    const hit = (c.match(/[a-z]{2,3}-[A-Z]{2}/) || [])[0];
    return langByCode(hit).code || detectLang(text);
  }catch(e){ return detectLang(text); }
}

/* ------------------------- state ------------------------- */
const DEFAULT_SETTINGS = {
  langA:'en-US', langB:'es-ES',
  provider:'free', baseUrl:'https://api.openai.com/v1', model:'gpt-4o-mini', apiKey:'',
  feedbackStyle:'balanced',
  autoSpeak:true, autoTurn:true, coach:true,
  realMicLevels:false, micEnabled:true,
  silenceMs:900,
  ttsRate:1,
  accent:'aurora',
  googleClientId:'', appleClientId:'', githubClientId:'', discordClientId:'', githubProxy:'',
};
let S = Object.assign({}, DEFAULT_SETTINGS);
let turns = [];              // {id, speaker, srcCode, dstCode, orig, trans, feedback, ts, ms, star}
let historyLocked = false;   // true when a password account is loaded but not yet re-authenticated (history stays encrypted)
let favoritesOnly = false;
let listening = false;
let speaking  = false;
let currentSpeaker = 'A';
let demoRunning = false;

const $  = id => document.getElementById(id);
const el = (tag, cls, html) => { const n = document.createElement(tag); if(cls) n.className = cls; if(html != null) n.innerHTML = html; return n; };

/* ------------------------- persistence -------------------------
   SECURITY LAYER (two layers + defense-in-depth)
   1) DEVICE-BOUND KEY (lp_devkey, AES-GCM 256). Encrypts guest history,
      settings and the account list at rest so private data is never in
      plaintext localStorage, is bound to this device, and is integrity
      checked (AES-GCM rejects tampering).
   2) PASSWORD-DERIVED KEY (per-account PBKDF2-HMAC-SHA-256, AES-GCM 256).
      Each account's conversation history is encrypted under a key derived
      from the user's password (salt + iterations stored on the account
      record). The key is derived in memory on login and NEVER persisted,
      so even with the device key + full storage dump an attacker still
      needs the password to read any conversation. On app restart we
      require re-auth before the history can be decrypted.
   - Every object is validated/sanitised on read, so corrupt or hostile
     storage can never crash the app or inject content.
   - If Web Crypto (crypto.subtle) is unavailable (a non-secure context)
     we transparently fall back to device-key-only / plaintext so the app
     still works (with a visible warning that the mic/security is limited).
   ---------------------------------------------------------------- */
const HAS_SUBTLE = !!(window.crypto && window.crypto.subtle);
const ENC_TAG = 'LPENC1:';
const PBKDF2_ITER = 150000;          // PBKDF2 iteration count for password-derived keys
let _devKey = null;
let sessionDataKey = null;   // account data-encrypting key (password-derived, PBKDF2) — kept in memory only, never persisted

function hexToBytes(hex){ const a = new Uint8Array(hex.length/2); for(let i=0;i<hex.length;i+=2) a[i/2] = parseInt(hex.substr(i,2),16); return a; }
function bytesToHex(buf){ return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join(''); }
function bytesToB64(buf){ const b = new Uint8Array(buf); let s=''; for(let i=0;i<b.length;i++) s += String.fromCharCode(b[i]); return btoa(s); }
function b64ToBytes(s){ const bin = atob(s); const a = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) a[i] = bin.charCodeAt(i); return a; }

async function devKey(){
  if(_devKey) return _devKey;
  let hex = null; try{ hex = localStorage.getItem('lp_devkey'); }catch(e){}
  if(!hex){
    hex = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    try{ localStorage.setItem('lp_devkey', hex); }catch(e){}
  }
  _devKey = await crypto.subtle.importKey('raw', hexToBytes(hex), { name:'AES-GCM' }, false, ['encrypt','decrypt']);
  return _devKey;
}

// store an object encrypted (AES-GCM). Falls back to plaintext JSON when Web Crypto is unavailable.
// keyObj: an explicit CryptoKey to encrypt with (e.g. a password-derived account key); defaults to the device key.
async function encStore(key, obj, keyObj){
  const json = JSON.stringify(obj);
  const k = keyObj || await devKey();
  if(!HAS_SUBTLE){ try{ localStorage.setItem(key, json); }catch(e){} return; }
  try{
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, k, new TextEncoder().encode(json));
    localStorage.setItem(key, ENC_TAG + bytesToB64(iv) + '.' + bytesToB64(ct));
  }catch(e){}
}
// read an object previously written by encStore. Returns null on missing/tampered; legacy plaintext is parsed directly.
async function decStore(key, keyObj){
  let raw = null; try{ raw = localStorage.getItem(key); }catch(e){ return null; }
  if(!raw) return null;
  if(!raw.startsWith(ENC_TAG)){ try{ return JSON.parse(raw); }catch(e){ return null; } }   // legacy plaintext
  if(!HAS_SUBTLE) return null;
  try{
    const parts = raw.slice(ENC_TAG.length).split('.');
    const pt = await crypto.subtle.decrypt({ name:'AES-GCM', iv: b64ToBytes(parts[0]) }, keyObj || await devKey(), b64ToBytes(parts[1]));
    return JSON.parse(new TextDecoder().decode(pt));
  }catch(e){ return null; }   // tampered or wrong key -> treat as empty (integrity failure)
}

// derive a per-account data-encrypting key from the user's password (PBKDF2-HMAC-SHA-256 -> AES-GCM 256)
async function deriveDataKey(password, saltB64, iterations){
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name:'PBKDF2' }, false, ['deriveKey']);
  return await crypto.subtle.deriveKey(
    { name:'PBKDF2', salt: b64ToBytes(saltB64), iterations: iterations || PBKDF2_ITER, hash:'SHA-256' },
    base, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
}
// the key to use for conversation history: an account's password-derived key when signed in, else the device key.
async function activeKey(){ return sessionDataKey || (await devKey()); }

async function loadSettings(){
  const obj = await decStore('linguapulse.settings');
  return Object.assign({}, DEFAULT_SETTINGS, obj && typeof obj === 'object' ? obj : {});
}
// Build the per-account preference copy. The account record is encrypted only
// under the DEVICE key, so it must never carry device-level secrets — the API key
// stays solely in the device-keyed global settings blob (linguapulse.settings).
function accountPrefs(){
  const p = Object.assign({}, DEFAULT_SETTINGS, S);
  delete p.apiKey;
  return p;
}
async function saveSettings(){
  try{ await encStore('linguapulse.settings', S); }catch(e){}   // API key lives here (device-key only)
  const acc = currentAccount();
  if(acc){ acc.prefs = accountPrefs(); await saveAccounts(loadAccounts().map(a => a.id === acc.id ? acc : a)); }
}

/* ------------------------- accounts (in-memory cache, encrypted at rest) ------------------------- */
let ACCOUNTS = [];
async function reloadAccounts(){ ACCOUNTS = sanitizeAccounts(await _decAccounts()); }
function loadAccounts(){ return ACCOUNTS; }
async function _decAccounts(){ const arr = await decStore('lp_accounts'); return Array.isArray(arr) ? arr : []; }
async function saveAccounts(accs){ ACCOUNTS = accs; await encStore('lp_accounts', accs); }

/* ------------------------- history (persisted per context) ------------------------- */
function historyKey(){ const id = getSessionId(); return 'lp_hist_' + (id || 'guest'); }
async function loadTurns(key){
  const k = await activeKey();
  let data = await decStore(key, k);
  if(data === null && k) data = await decStore(key);   // legacy blob (pre-upgrade, device-key only) -> migrate on next save
  return sanitizeTurns(data);
}
async function saveTurns(){
  if(historyLocked) return;   // don't persist under the wrong key while the account is locked
  try{ await encStore(historyKey(), turns, await activeKey()); }catch(e){}
  saveStatsSummary();
}
async function loadContextHistory(){ turns = await loadTurns(historyKey()); renderFeed(); }

/* content-free per-context summary so the login data-sheet works without exposing conversation text */
function saveStatsSummary(){
  const id = getSessionId() || 'guest';
  const real = turns.filter(t => !t.demo);
  const langs = [...new Set(real.map(t => t.srcCode))];
  const days  = [...new Set(real.map(t => dayKey(t.ts)))];
  try{ localStorage.setItem('lp_stats_' + id, JSON.stringify({ turns: real.length, langs, days })); }catch(e){}
}

/* ------------------------- sanitisation / validation on read ------------------------- */
function sanitizeFeedback(f){
  if(!f || typeof f !== 'object') return null;
  const clamp = (x, lo, hi, d) => { const n = Number(x); return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : d; };
  return {
    score:    clamp(f.score, 0, 100, 0),
    engine:   f.engine === 'llm' ? 'llm' : 'local',
    wpm:      clamp(f.wpm, 0, 1000, 0),
    words:    clamp(f.words, 0, 100000, 0),
    fix:      typeof f.fix === 'string' ? f.fix.slice(0, 2000) : '',
    fixLabel: typeof f.fixLabel === 'string' ? f.fixLabel.slice(0, 200) : '',
    notes:    Array.isArray(f.notes) ? f.notes.filter(n => typeof n === 'string').map(n => n.slice(0, 2000)).slice(0, 12) : [],
    gloss:    typeof f.gloss === 'string' ? f.gloss.slice(0, 2000) : '',
  };
}
const _LANG_CODES = new Set(LANGS.map(l => l.code));
function sanitizeTurns(arr){
  if(!Array.isArray(arr)) return [];
  return arr.filter(t => t && typeof t === 'object')
    .map(t => ({
      id:        String(t.id || '').slice(0, 64),
      speaker:   t.speaker === 'B' ? 'B' : 'A',
      srcCode:   _LANG_CODES.has(t.srcCode) ? t.srcCode : 'en-US',
      dstCode:   _LANG_CODES.has(t.dstCode) ? t.dstCode : 'es-ES',
      orig:      typeof t.orig === 'string' ? t.orig.slice(0, 5000) : '',
      trans:     typeof t.trans === 'string' ? t.trans.slice(0, 5000) : '',
      feedback:  sanitizeFeedback(t.feedback),
      ts:        (t.ts instanceof Date && !isNaN(t.ts)) ? t.ts : new Date(t.ts || Date.now()),
      ms:        (Number.isFinite(t.ms) ? Math.min(Math.max(t.ms | 0, 0), 600000) : 0),
      star:      !!t.star,
      demo:      !!t.demo,
      srcAuto:   !!t.srcAuto,
    }))
    .filter(t => t.orig);
}
function sanitizeAccount(a){
  if(!a || typeof a !== 'object') return null;
  if(typeof a.id !== 'string' || !a.id) return null;
  if(typeof a.email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email)) return null;
  const methods = Array.isArray(a.methods) ? a.methods.filter(m => typeof m === 'string' && PROVIDERS.includes(m)).slice(0, 8) : [];
  const hasPass = (typeof a.passHash === 'string' && !!a.passHash);
  // An account needs at least one way to sign in: a password, or an SSO/passkey method.
  if(!hasPass && methods.length === 0) return null;
  return {
    id: a.id.slice(0, 64),
    name: typeof a.name === 'string' ? a.name.slice(0, 80) : 'User',
    email: a.email.toLowerCase().slice(0, 160),
    passHash: hasPass ? a.passHash.slice(0, 128) : '',
    avatar: typeof a.avatar === 'string' ? a.avatar.slice(0, 8) : '',
    createdAt: Number.isFinite(a.createdAt) ? a.createdAt : Date.now(),
    prefs: (a.prefs && typeof a.prefs === 'object') ? a.prefs : Object.assign({}, DEFAULT_SETTINGS),
    salt: typeof a.salt === 'string' ? a.salt.slice(0, 64) : '',
    iter: Number.isFinite(a.iter) ? Math.min(Math.max(a.iter | 0, 10000), 2000000) : 0,
    methods,
    passkeys: Array.isArray(a.passkeys) ? a.passkeys.filter(p => typeof p === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(p)).slice(0, 8) : [],
  };
}
function sanitizeAccounts(arr){
  if(!Array.isArray(arr)) return [];
  const seen = new Set(); const out = [];
  for(const a of arr){ const s = sanitizeAccount(a); if(s && !seen.has(s.email)){ seen.add(s.email); out.push(s); } }
  return out;
}

/* ------------------------- theme ------------------------- */
function applyTheme(){
  let t = null; try{ t = localStorage.getItem('lp_theme'); }catch(e){}
  const theme = (t === 'light') ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  const b = $('themeBtn'); if(b) b.textContent = theme === 'light' ? '🌙' : '☀️';
}
function toggleTheme(){
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try{ localStorage.setItem('lp_theme', next); }catch(e){}
  const b = $('themeBtn'); if(b) b.textContent = next === 'light' ? '🌙' : '☀️';
  toast(next === 'light' ? 'Light theme' : 'Dark theme');
}

/* ------------------------- accent theme ------------------------- */
function applyAccent(){
  const a = (S.accent && typeof S.accent === 'string' && ['aurora','ocean','forest','sunset','mono'].includes(S.accent)) ? S.accent : 'aurora';
  document.documentElement.dataset.accent = a;
}

/* ------------------------- usage stats ------------------------- */
function dayKey(d){ d = (d instanceof Date) ? d : new Date(d); return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate(); }
function computeStreak(list){
  const days = new Set(list.filter(t=>!t.demo).map(t => dayKey(t.ts)));
  if(!days.size) return 0;
  let cur = new Date();
  if(!days.has(dayKey(cur))){ cur.setDate(cur.getDate()-1); if(!days.has(dayKey(cur))) return 0; }
  let streak = 0;
  while(days.has(dayKey(cur))){ streak++; cur.setDate(cur.getDate()-1); }
  return streak;
}

/* ------------------------- toast ------------------------- */
let toastTimer;
function toast(msg, kind){
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}

/* ============================================================
   SPEECH RECOGNITION
   ============================================================ */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null, finalBuf = '', interim = '', uttStart = 0, commitTimer = null, restartLock = false;
let recogRestarts = 0, lastRecogEnd = 0;
let micMeterRAF = null;

function supported(){ return !!SR; }

function buildRecog(){
  if(!SR) return null;
  const r = new SR();
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 1;
  r.lang = recogLangHint(currentSpeaker);

  r.onresult = e => {
    let fin = '', inter = '';
    for(let i = e.resultIndex; i < e.results.length; i++){
      const res = e.results[i];
      const txt = res[0].transcript;
      if(res.isFinal) fin += txt + ' '; else inter += txt;
    }
    if(fin){
      if(!finalBuf) uttStart = Date.now();
      finalBuf += fin;
    }
    interim = inter;
    const shown = (finalBuf + interim).trim();
    setCaption(shown || 'Listening…');
    // commit after a configurable pause of silence
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commitUtterance, S.silenceMs || 900);
  };

  r.onerror = e => {
    const err = e.error;
    if(err === 'no-speech' || err === 'aborted') return;
    if(err === 'network'){
      // Transient (connection blip). Don't tear down — onend will restart us.
      toast('Speech connection hiccup — reconnecting…', 'err');
      return;
    }
    const msgs = {
      'not-allowed':'Microphone blocked — allow mic access and try again.',
      'service-not-allowed':'Speech service unavailable. Try Chrome or Edge.',
      'audio-capture':'No microphone found on this device.',
    };
    toast(msgs[err] || ('Recognition error: ' + err), 'err');
    stopListening();
    if(err === 'not-allowed' || err === 'audio-capture' || err === 'service-not-allowed'){
      setOrbState('idle');
      $('orbStatus').textContent = 'Mic blocked — tap to retry';
    }
  };

  r.onend = () => {
    // Chrome ends the session periodically; restart while we still want to listen.
    if(listening && !speaking && !restartLock){
      restartLock = true;
      setTimeout(() => {
        restartLock = false;
        if(listening && !speaking){
          // backoff: if the session keeps ending within ~1.2s, pause and ask the user to retry
          const now = Date.now();
          recogRestarts = (now - lastRecogEnd < 1200) ? recogRestarts + 1 : 0;
          lastRecogEnd = now;
          if(recogRestarts > 8){
            recogRestarts = 0; listening = false; setOrbState('idle');
            $('orbStatus').textContent = 'Mic reconnect needed — tap orb';
            toast('Microphone kept dropping. Tap the orb to resume.', 'err');
            return;
          }
          safeStart();
        }
      }, 300);
    }
  };
  return r;
}

function safeStart(){
  try{ recog && recog.start(); }
  catch(e){ /* already started — ignore */ }
}

function startListening(){
  if(!supported()){ toast('Speech recognition is not supported here. Use Chrome or Edge, or run the Demo.', 'err'); return; }
  if(S.micEnabled === false){ toast('Microphone is turned off in Settings. Turn it on, or tap Demo to watch a sample conversation.', 'err'); return; }
  if(micPerm === 'denied'){ toast('Microphone access is blocked. Open Settings → “Request / re-enable”, or allow it in your browser’s site settings.', 'err'); return; }
  listening = true;
  if(!recog) recog = buildRecog();
  recog.lang = recogLangHint(currentSpeaker);
  safeStart();
  setOrbState('listening');
  $('orbStatus').textContent = 'Listening…';
  $('orbGlow').classList.add('live');
  setCaption('Listening…');
  markSpeakingChip();
  if(S.realMicLevels){ enableMicLevels(); const w = $('micMeterWrap'); if(w) w.hidden = false; startMicMeter(); }
}

function stopListening(){
  listening = false;
  clearTimeout(commitTimer);
  try{ recog && recog.stop(); }catch(e){}
  setOrbState('idle');
  $('orbStatus').textContent = 'Tap to listen';
  $('orbGlow').classList.remove('live');
  maybeCommitNow();
  markSpeakingChip();
  disableMicLevels();
  const w = $('micMeterWrap'); if(w) w.hidden = true;
  stopMicMeter();
}

function maybeCommitNow(){ if(finalBuf.trim()) commitUtterance(); }

/* ============================================================
   MICROPHONE PERMISSION
   ============================================================ */
let micPerm = 'unknown';   // 'granted' | 'denied' | 'prompt' | 'unknown' | 'unsupported'

function applyMicEnabled(){
  const off = S.micEnabled === false;
  const btn = $('micBtn');
  btn.classList.toggle('mic-disabled', off);
  btn.setAttribute('aria-disabled', off ? 'true' : 'false');
  if(off && !listening) $('orbStatus').textContent = 'Microphone off';
}

async function refreshMicPerm(){
  const dot = $('micPermDot'), txt = $('micPermText'), help = $('micPermHelp');
  if(!navigator.permissions || !navigator.permissions.query){
    micPerm = 'unknown';
    dot.className = 'mic-perm-dot warn';
    txt.textContent = 'Unknown — tap Request';
    if(help) help.textContent = 'This browser doesn’t expose a live mic-status API. Tap “Request / re-enable” to grant access.';
    return;
  }
  try{
    const st = await navigator.permissions.query({ name:'microphone' });
    const paint = state => {
      micPerm = state;
      dot.className = 'mic-perm-dot ' + (state === 'granted' ? 'ok' : state === 'denied' ? 'bad' : 'warn');
      txt.textContent = state === 'granted' ? 'Allowed' : state === 'denied' ? 'Blocked' : 'Not yet requested';
    };
    paint(st.state);
    st.onchange = () => paint(st.state);
  }catch(e){
    micPerm = 'unknown';
    dot.className = 'mic-perm-dot warn';
    txt.textContent = 'Unknown — tap Request';
  }
}

async function requestMicPermission(){
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    toast('Microphone API isn’t available in this browser.', 'err');
    return;
  }
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    stream.getTracks().forEach(t => t.stop());
    await refreshMicPerm();
    toast('Microphone access granted ✓', 'ok');
  }catch(err){
    await refreshMicPerm();
    const blocked = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    toast(blocked
      ? 'Microphone blocked. Enable it in your browser’s site settings (the 🔒 icon), then tap “Request / re-enable”.'
      : ('Microphone error: ' + (err && err.name || err)),
      'err');
  }
}

function commitUtterance(){
  clearTimeout(commitTimer);
  const text = finalBuf.trim();
  finalBuf = ''; interim = '';
  if(!text) return;
  const ms = Math.max(600, Date.now() - (uttStart || Date.now()));
  uttStart = 0;
  setCaption('Translating…');
  setOrbState('working');
  createTurn(text, ms);
}

/* ============================================================
   TURN PIPELINE
   ============================================================ */
async function createTurn(text, ms){
  const myLang = currentSpeaker === 'A' ? S.langA : S.langB;
  const partnerLang = currentSpeaker === 'A' ? S.langB : S.langA;
  let srcCode, dstCode;
  const srcAuto = (myLang === 'auto');
  if(srcAuto){
    const hasLLM = S.provider === 'openai' && S.apiKey;
    srcCode = hasLLM ? await detectLangLLM(text) : detectLang(text);
    lastDetected[currentSpeaker] = srcCode;
  } else {
    srcCode = myLang;
  }
  if(partnerLang && partnerLang !== 'auto'){
    dstCode = partnerLang;
    // guard against a degenerate same-language turn (auto mis-detected the partner's tongue)
    if(dstCode === srcCode) dstCode = (srcCode === 'en-US') ? 'es-ES' : 'en-US';
  } else {
    dstCode = (srcCode === 'en-US') ? 'es-ES' : 'en-US';
  }
  setOrbState('working');

  const turn = {
    id: 't' + Date.now() + Math.random().toString(36).slice(2,6),
    speaker: currentSpeaker, srcCode, dstCode, srcAuto,
    orig: text, trans: '', feedback: null, ts: new Date(), ms,
  };
  turns.push(turn);
  renderTurn(turn);
  updateCount();

  try {
    // 1) translate
    try {
      turn.trans = await translate(text, srcCode, dstCode);
    } catch(err) {
      turn.trans = '⚠ Translation unavailable — check your connection or add an API key in Settings.';
      toast('Translation failed: ' + (err.message || 'network error'), 'err');
    }
    updateTurnBody(turn);

    // 2) coaching feedback in the TARGET language (analyses what you said)
    if(S.coach){
      try { turn.feedback = await coach(text, turn.trans, srcCode, dstCode, ms); }
      catch(e){ /* non-fatal */ }
      updateTurnBody(turn);
    }

    // 3) speak the translation out loud
    if(S.autoSpeak && turn.trans && !/^⚠/.test(turn.trans)) await speak(turn.trans, dstCode, turn.id);
  } catch(e) {
    console.error(e);
    toast('Something went wrong processing that turn.', 'err');
  }

  // 4) turn-taking: hand the floor to the other person
  if(S.autoTurn){
    currentSpeaker = currentSpeaker === 'A' ? 'B' : 'A';
    markSpeakingChip();
    if(listening) setCaption('Speaker ' + currentSpeaker + "'s turn — listening…");
  }

  saveTurns();
  setOrbState(listening ? 'listening' : 'idle');
  if(listening) setCaption('Listening…'); else setCaption('Tap to listen');
}

/* ============================================================
   TRANSLATION
   ============================================================ */
/* ============================================================
   TRANSLATION  — resilient · cached · multi-engine
   Order:  LLM (if an OpenAI-compatible key is set) → MyMemory → LibreTranslate.
   Results are cached in localStorage so repeat phrases are instant and we stay
   well under MyMemory's free daily quota (and keep working if it blips).
   ============================================================ */
const TCACHE_KEY = 'lp_tcache';
const TCACHE_TTL = 30 * 24 * 3600 * 1000;
const TCACHE_MAX = 600;

function cacheGet(k){
  try{
    const m = JSON.parse(localStorage.getItem(TCACHE_KEY) || '{}');
    const e = m[k];
    if(e && Date.now() - e.ts < TCACHE_TTL) return e.t;
    if(e) delete m[k];
  }catch(_){}
  return null;
}
function cacheSet(k, v){
  try{
    const m = JSON.parse(localStorage.getItem(TCACHE_KEY) || '{}');
    m[k] = { t: v, ts: Date.now() };
    const keys = Object.keys(m);
    if(keys.length > TCACHE_MAX){
      keys.sort((a, b) => m[a].ts - m[b].ts);
      for(const old of keys.slice(0, keys.length - TCACHE_MAX)) delete m[old];
    }
    localStorage.setItem(TCACHE_KEY, JSON.stringify(m));
  }catch(_){}
}

// A result is "garbage" when the engine clearly didn't translate:
//  - empty / quota warning,  - mojibake from broken encoding (common on non-Latin via MyMemory),
//  - or an exact echo of the source (same script, identical after normalisation).
function isGarbage(src, out){
  if(!out || !out.trim()) return true;
  if(/MYMEMORY WARNING|QUERY LENGTH LIMIT|USAGE LIMIT/i.test(out)) return true;
  if(/Ã.|Â.|â€|Ã¢|Ã©|Ã¨/.test(out)) return true;
  const a = src.trim().toLowerCase().replace(/\s+/g, ' ');
  const b = out.trim().toLowerCase().replace(/\s+/g, ' ');
  if(a && a === b) return true;
  return false;
}

async function fetchWithTimeout(url, opts, ms){
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, Object.assign({ signal: ctrl.signal }, opts)); }
  finally { clearTimeout(id); }
}

async function engineMyMemory(text, from, to){
  const chunks = chunkText(text, 430);
  const parts = [];
  for(const c of chunks){
    const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(c) + '&langpair=' + from + '|' + to;
    const r = await fetchWithTimeout(url, {}, 9000);
    if(!r.ok) throw new Error('MyMemory ' + r.status);
    const j = await r.json();
    const t = (j && j.responseData && j.responseData.translatedText) || '';
    parts.push(decodeEntities(t));
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// Best-effort second free engine (Argos/LibreTranslate public demo; CORS-enabled).
async function engineLibre(text, from, to){
  const url = 'https://translate.argosopentech.com/translate';
  const r = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source: from, target: to, format: 'text' }),
  }, 9000);
  if(!r.ok) throw new Error('LibreTranslate ' + r.status);
  const j = await r.json();
  const t = j && j.translatedText;
  if(!t) throw new Error('LibreTranslate empty');
  return (Array.isArray(t) ? t.join(' ') : t).trim();
}

async function translate(text, srcCode, dstCode){
  const from = langByCode(srcCode).base;
  const to   = langByCode(dstCode).base;
  if(from === to) return text;                                   // nothing to translate
  const key = from + '|' + to + '|' + text.trim().replace(/\s+/g, ' ');
  const hit = cacheGet(key);
  if(hit) return hit;

  const hasLLM = S.provider === 'openai' && S.apiKey;
  const engines = hasLLM ? ['llm', 'mymemory', 'libre'] : ['mymemory', 'libre'];
  let out = null;
  for(const eng of engines){
    try {
      const r = eng === 'llm'      ? await llmTranslate(text, srcCode, dstCode)
              : eng === 'mymemory' ? await engineMyMemory(text, from, to)
              :                      await engineLibre(text, from, to);
      if(!isGarbage(text, r)){ out = r; break; }
    } catch(_) { /* try the next engine */ }
  }
  if(out == null) throw new Error('all translation engines failed (quota or offline)');
  cacheSet(key, out);
  return out;
}

async function llmTranslate(text, srcCode, dstCode){
  const src = langByCode(srcCode).label, dst = langByCode(dstCode).label;
  const prompt =
    `You are a professional real-time interpreter. Translate the following ${src} utterance into ` +
    `natural, conversational ${dst}. Preserve the speaker's tone and register. ` +
    `Return ONLY the translated text — no quotes, no commentary, no "Translation:".\n\n${text}`;
  return (await llmChat([
    { role: 'system', content: 'You are a precise, professional interpreter for live conversation.' },
    { role: 'user', content: prompt }
  ], 0.2)).trim();
}

async function llmChat(messages, temperature){
  const url = S.baseUrl.replace(/\/$/, '') + '/chat/completions';
  const body = { model: S.model, messages, temperature: temperature ?? 0.4 };
  const r = await fetch(url, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + S.apiKey },
    body: JSON.stringify(body),
  });
  if(!r.ok){
    const t = await r.text().catch(()=> '');
    throw new Error('API ' + r.status + ' ' + t.slice(0,120));
  }
  const j = await r.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
}

function chunkText(text, max){
  if(text.length <= max) return [text];
  const parts = text.split(/(?<=[.!?;])\s+/);
  const out = []; let buf = '';
  for(const p of parts){
    if((buf + ' ' + p).trim().length > max && buf){ out.push(buf.trim()); buf = p; }
    else buf = (buf + ' ' + p).trim();
  }
  if(buf) out.push(buf);
  return out;
}
function decodeEntities(s){
  const ta = document.createElement('textarea');
  ta.innerHTML = s; return ta.value;
}

/* ============================================================
   COACHING FEEDBACK (written in the target language)
   ============================================================ */
const FILLERS = {
  en:['um','uh','er','like','you know','i mean','sort of','basically','actually','right'],
  es:['este','eh','pues','o sea','entonces','bueno','vale','como que'],
  fr:['euh','du coup','genre','quoi','ben','en fait'],
  de:['ähm','halt','sozusagen','eigentlich','irgendwie'],
  it:['tipo','praticamente','allora','cioè','dai'],
  pt:['tipo','né','aí','então','bem'],
  ru:['эээ','ну','типа','короче','в общем'],
};

const T = {
  en:{ filler:w=>`Watch the filler words (“${w}”) — they soften your message.`,
       long:n=>`That ran ${n} words. Split it into two shorter sentences next time.`,
       fast:w=>`You spoke at ${w} words/min — a little fast for a learner. Slow down on the key words.`,
       slow:w=>`${w} words/min is comfortable, but keep the flow going between phrases.`,
       repeat:w=>`You said “${w}” twice in a row — swap one for a synonym.`,
       fix:'A more natural way to say it:',
       praise:'Clear and natural — that landed well.',
       pace:'Pace' },
  es:{ filler:w=>`Cuidado con las muletillas («${w}»): restan seguridad a lo que dices.`,
       long:n=>`Usaste ${n} palabras de una vez. Prueba a dividirlo en frases más cortas.`,
       fast:w=>`Hablaste a ${w} palabras por minuto, algo rápido. Baja el ritmo en las palabras clave.`,
       slow:w=>`${w} palabras por minuto está bien, pero mantén el hilo entre frases.`,
       repeat:w=>`Repetiste «${w}» dos veces; sustituye una por un sinónimo.`,
       fix:'Una forma más natural de decirlo:',
       praise:'Claro y natural, ¡bien dicho!',
       pace:'Ritmo' },
  fr:{ filler:w=>`Attention aux mots de remplissage («${w}») : ils affaiblissent votre message.`,
       long:n=>`${n} mots d’un coup. Essayez de couper en deux phrases plus courtes.`,
       fast:w=>`Vous parlez à ${w} mots/min, un peu vite. Ralentissez sur les mots importants.`,
       slow:w=>`${w} mots/min, c’est confortable — gardez juste le fil entre les phrases.`,
       repeat:w=>`Vous avez répété «${w}» deux fois ; remplacez l’un par un synonyme.`,
       fix:'Une façon plus naturelle de le dire :',
       praise:'Clair et naturel, bien joué.',
       pace:'Débit' },
  de:{ filler:w=>`Achte auf Füllwörter („${w}“) — sie schwächen deine Aussage.`,
       long:n=>`${n} Wörter am Stück. Teile den Satz das nächste Mal in zwei kürzere.`,
       fast:w=>`Du sprichst ${w} Wörter/Minute, etwas schnell. Verlangsame die wichtigen Wörter.`,
       slow:w=>`${w} Wörter/Minute ist angenehm — halte nur den Fluss zwischen den Sätzen.`,
       repeat:w=>`Du hast „${w}“ zweimal gesagt; ersetze eines durch ein Synonym.`,
       fix:'Natürlicher gesagt:',
       praise:'Klar und natürlich — gut gesagt.',
       pace:'Tempo' },
  it:{ filler:w=>`Attenzione alle parole riempitive («${w}»): indeboliscono il messaggio.`,
       long:n=>`${n} parole di fila. Prova a spezzare in due frasi più corte.`,
       fast:w=>`Hai parlato a ${w} parole/minuto, un po’ veloce. Rallenta sulle parole chiave.`,
       slow:w=>`${w} parole/minuto va bene, ma mantieni il flusso tra le frasi.`,
       repeat:w=>`Hai ripetuto «${w}» due volte; sostituiscine uno con un sinonimo.`,
       fix:'Un modo più naturale per dirlo:',
       praise:'Chiaro e naturale, ben detto.',
       pace:'Ritmo' },
  pt:{ filler:w=>`Cuidado com as palavras de enchimento («${w}»): enfraquecem a mensagem.`,
       long:n=>`${n} palavras de uma vez. Tente dividir em duas frases mais curtas.`,
       fast:w=>`Você falou a ${w} palavras/minuto, um pouco rápido. Desacelere nas palavras-chave.`,
       slow:w=>`${w} palavras/minuto está bom, mas mantenha o fluxo entre as frases.`,
       repeat:w=>`Você repetiu «${w}» duas vezes; troque uma por um sinônimo.`,
       fix:'Uma forma mais natural de dizer:',
       praise:'Claro e natural, muito bem.',
       pace:'Ritmo' },
  'zh-CN':{ filler:w=>`注意口头禅（“${w}”），它们会削弱表达力度。`,
       long:n=>`一口气说了 ${n} 个词，下次可以拆成更短的句子。`,
       fast:w=>`语速约 ${w} 词/分钟，偏快。关键词上放慢一点。`,
       slow:w=>`${w} 词/分钟是合适的，注意句与句之间的连贯。`,
       repeat:w=>`你连着两次用了“${w}”，可以把其中一处换成同义词。`,
       fix:'更自然的说法：',
       praise:'表达清晰自然，很好。',
       pace:'语速' },
  ja:{ filler:w=>`フィラー（「${w}」）に注意すると、より自信のある話し方になります。`,
       long:n=>`${n}語と長めでした。次は短い文に分けてみましょう。`,
       fast:w=>`${w}語/分と少し速めです。大切な語はゆっくり話しましょう。`,
       slow:w=>`${w}語/分は十分です。文と文のつながりを意識しましょう。`,
       repeat:w=>`「${w}」を続けて使っています。一方は類義語に置き換えましょう。`,
       fix:'より自然な言い方：',
       praise:'明快で自然な表現でした。',
       pace:'速度' },
};

const FIXES = {
  en:[
    [/\bi am agree\b/gi,'I agree'], [/\bdiscuss about\b/gi,'discuss'], [/\bmore better\b/gi,'better'],
    [/\binformations\b/gi,'information'], [/\badvices\b/gi,'advice'], [/\bpeoples\b/gi,'people'],
    [/\bi very like\b/gi,'I really like'], [/\bhe go\b/gi,'he goes'], [/\bshe go\b/gi,'she goes'],
    [/\bi have (\d+) years?\b/gi,'I am $1 years old'], [/\bexplain me\b/gi,'explain to me'],
    [/\bmarried with\b/gi,'married to'], [/\bdepends of\b/gi,'depends on'], [/\bi'?m boring\b/gi,"I'm bored"],
    [/\bmake a photo\b/gi,'take a photo'], [/\bcan you say me\b/gi,'can you tell me'],
  ],
  es:[
    [/\bmás mejor\b/gi,'mejor'], [/\bsoy de acuerdo\b/gi,'estoy de acuerdo'], [/\btengo (\d+) años viejo\b/gi,'tengo $1 años'],
    [/\bpienso que sí\b/gi,'creo que sí'], [/\bpor qué no\b(?=\s*$)/gi,'claro que sí'],
  ],
  fr:[
    [/\bje suis d'accord avec toi\b/gi,"je suis d'accord"], [/\bplus meilleur\b/gi,'meilleur'],
  ],
  de:[
    [/\bich bin agree\b/gi,'ich stimme zu'], [/\bmehr besser\b/gi,'besser'],
  ],
};

async function coach(orig, trans, srcCode, dstCode, ms){
  const dst = langByCode(dstCode);
  const src = langByCode(srcCode);
  if(S.provider === 'openai' && S.apiKey) return llmCoach(orig, trans, src, dst, ms);

  // ---- local heuristic engine ----
  const words = orig.trim().split(/\s+/).filter(Boolean);
  const n = words.length;
  const wpm = Math.round(n / Math.max(ms / 60000, 0.02));
  const tmpl = T[dst.base] || T.en;
  const notes = [];

  const fillers = FILLERS[src.base] || [];
  const low = orig.toLowerCase();
  const hit = fillers.filter(f => new RegExp('(^|[^a-zà-ÿ])' + escapeRe(f) + '([^a-zà-ÿ]|$)', 'i').test(low));
  if(hit.length) notes.push({ kind:'filler', text: tmpl.filler(hit.slice(0,3).join('”, “')) });

  if(n > 28) notes.push({ kind:'long', text: tmpl.long(n) });

  if(wpm > 185) notes.push({ kind:'pace', text: tmpl.fast(wpm) });
  else if(n >= 6 && wpm < 95) notes.push({ kind:'pace', text: tmpl.slow(wpm) });

  // consecutive repetition
  for(let i = 1; i < words.length; i++){
    if(words[i].toLowerCase().replace(/[^\p{L}]/gu,'') === words[i-1].toLowerCase().replace(/[^\p{L}]/gu,'') &&
       words[i].replace(/[^\p{L}]/gu,'').length > 3){
      notes.push({ kind:'repeat', text: tmpl.repeat(words[i]) });
      break;
    }
  }

  // unsupported target language: the on-device rule templates only cover
  // en/es/fr/de/it/pt/zh/ja, so say so plainly instead of faking a note.
  if(!T[dst.base]){
    notes.push({ kind:'note', text:`On-device coaching for ${dst.label} is limited — connect an API key in Settings for full ${dst.label}-language coaching.` });
  }

  // common mistakes -> corrected version
  let corrected = orig.trim();
  corrected = corrected.charAt(0).toUpperCase() + corrected.slice(1);
  let changedByFix = null;
  for(const [re, rep] of (FIXES[src.base] || [])){
    if(re.test(corrected)){ corrected = corrected.replace(re, rep); changedByFix = rep; }
  }
  corrected = corrected.replace(/\b(\w+)\s+\1\b/gi, '$1').replace(/\s+([,.!?])/g, '$1');
  if(!/[.!?]$/.test(corrected)) corrected += '.';
  const isSame = corrected.trim().toLowerCase() === orig.trim().toLowerCase();
  if(!notes.length && isSame) notes.push({ kind:'praise', text: tmpl.praise });

  // fluency score
  let score = 92;
  score -= hit.length * 7;
  score -= changedByFix ? 12 : 0;
  score -= n > 28 ? 8 : 0;
  score -= (wpm > 185 || (n >= 6 && wpm < 95)) ? 6 : 0;
  score -= notes.some(x => x.kind === 'repeat') ? 5 : 0;
  score += (n >= 6 && n <= 20 && !hit.length) ? 4 : 0;
  score = Math.max(35, Math.min(99, score));

  return {
    score,
    fixLabel: tmpl.fix,
    fix: isSame ? '' : corrected,
    notes: notes.map(x => x.text),
    gloss: buildGloss(notes, wpm, n, src.label),
    wpm, words: n,
    engine: 'local',
  };
}

function buildGloss(notes, wpm, n, srcLabel){
  // English gloss so the learner always understands the note
  const map = {
    filler:'Filler words detected',
    long:'Sentence is long (' + n + ' words)',
    pace:'Pace issue (' + wpm + ' wpm)',
    repeat:'Repeated a word twice',
    praise:'No issues found',
  };
  const kinds = notes.map(x => x.kind);
  const parts = kinds.length ? kinds.map(k => map[k] || k) : ['No issues found'];
  return srcLabel + ' · ' + parts.join(' · ');
}

async function llmCoach(orig, trans, src, dst, ms){
  const wpm = Math.round(orig.trim().split(/\s+/).filter(Boolean).length / Math.max(ms/60000, 0.02));
  const style = {
    balanced:'Be balanced: point out the most useful 1–2 improvements, then one short encouragement.',
    strict:'Be strict: list every grammar, word-choice, and register problem you can find.',
    gentle:'Be gentle: lead with what worked, then suggest at most one light improvement.',
  }[S.feedbackStyle] || '';

  const sys =
    `You are a language coach sitting in a live conversation. ` +
    `The learner is speaking ${src.label}. Their utterance has been translated into ${dst.label}. ` +
    `You MUST write all of your feedback in ${dst.label} (the language being translated INTO), ` +
    `except the "gloss" field which is a short English summary. ${style} ` +
    `Keep each note to one short sentence. Never repeat the utterance back verbatim.`;

  const user =
    `Utterance (${src.label}): ${orig}\n` +
    `Translation (${dst.label}): ${trans}\n` +
    `Speaking pace: ${wpm} words per minute.\n\n` +
    `Return strict JSON:\n` +
    `{"score":<0-100 fluency score>,"fixLabel":"<short label in ${dst.label} like 'A more natural way to say it:'>",` +
    `"fix":"<corrected version in ${src.label}, or empty string if already perfect>",` +
    `"notes":["<note 1 in ${dst.label}>","<note 2 in ${dst.label}>"],` +
    `"gloss":"<one-line English summary>"}`;

  const raw = await llmChat([
    { role:'system', content: sys },
    { role:'user', content: user }
  ], 0.5);

  let data = null;
  try{
    const m = raw.match(/\{[\s\S]*\}/);
    data = JSON.parse(m ? m[0] : raw);
  }catch(e){ throw new Error('bad coach json'); }

  return {
    score: Math.max(0, Math.min(100, Number(data.score) || 80)),
    fixLabel: data.fixLabel || '',
    fix: (data.fix || '').trim(),
    notes: Array.isArray(data.notes) ? data.notes.filter(Boolean).slice(0,4) : [],
    gloss: data.gloss || '',
    wpm, words: orig.trim().split(/\s+/).filter(Boolean).length,
    engine: 'llm',
  };
}

function escapeRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* ============================================================
   SPEECH SYNTHESIS
   ============================================================ */
function speak(text, code, turnId){
  return new Promise(resolve => {
    if(!('speechSynthesis' in window)){ resolve(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = code;
    u.rate = (S.ttsRate || 1); u.pitch = 1;
    const v = pickVoice(code);
    if(v) u.voice = v;
    const btn = document.querySelector('.mini-btn[data-speak="' + turnId + '"]');
    if(btn) btn.classList.add('speaking');
    speaking = true;
    try{ if(recog && listening) recog.stop(); }catch(e){}   // avoid echo pickup
    u.onend = u.onerror = () => {
      speaking = false;
      if(btn) btn.classList.remove('speaking');
      if(listening && !demoRunning){
        if(recog) recog.lang = recogLangHint(currentSpeaker);  // track the flipped speaker
        setTimeout(safeStart, 250);
      }
      resolve();
    };
    try{ speechSynthesis.cancel(); speechSynthesis.speak(u); }
    catch(e){ speaking = false; resolve(); }
  });
}
let voices = [];
function pickVoice(code){
  if(!voices.length) voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  const base = code.split('-')[0];
  return voices.find(v => v.lang && v.lang.replace('_','-').toLowerCase() === code.toLowerCase())
      || voices.find(v => v.lang && v.lang.replace('_','-').toLowerCase().startsWith(base))
      || null;
}
if('speechSynthesis' in window){
  speechSynthesis.onvoiceschanged = () => { voices = speechSynthesis.getVoices(); };
}

/* ============================================================
   RENDERING
   ============================================================ */
function setOrbState(s){ $('orb').dataset.state = s; }
function setCaption(txt){
  const p = $('liveCaption'), box = $('captionBox');
  p.textContent = txt || 'Waiting for audio…';
  box.dataset.empty = txt ? 'false' : 'true';
}
function showDeployBanner(kind, html){
  const b = $('deployBanner'); if(!b) return;
  b.hidden = false;
  b.className = 'deploy-banner ' + (kind || 'warn');
  $('deployBannerIco').textContent = kind === 'err' ? '🔒' : '⚠️';
  $('deployBannerText').innerHTML = html;   // static, app-authored strings only
}
function markSpeakingChip(){
  $('langA').classList.toggle('is-speaking', currentSpeaker === 'A');
  $('langB').classList.toggle('is-speaking', currentSpeaker === 'B');
}
function updateCount(){
  $('feedCount').textContent = turns.length + (turns.length === 1 ? ' turn' : ' turns');
}

function fmtTime(ts){ return (ts instanceof Date ? ts : new Date(ts)).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }

function buildTurnNode(turn){
  const src = langMeta(turn.srcCode), dst = langMeta(turn.dstCode);
  const node = el('div', 'turn ' + (turn.speaker === 'A' ? 'speaker-a' : 'speaker-b') + (turn.star ? ' starred' : ''));
  node.id = turn.id;
  const autoTag = turn.srcAuto ? `<span class="turn-auto" title="Source language auto-detected">🌐 ${src.label}</span>` : '';
  node.innerHTML = `
    <div class="turn-head">
      <span class="avatar">${turn.speaker}</span>
      <span class="turn-who">Speaker ${turn.speaker}${turn.demo ? ' · demo' : ''}</span>
      <span class="turn-lang">${src.flag} → ${dst.flag}${autoTag}</span>
      <span class="turn-time">${fmtTime(turn.ts)}</span>
    </div>
    <div class="body-slot"></div>`;
  return node;
}

function renderTurn(turn){
  $('emptyState')?.remove();
  $('feed').appendChild(buildTurnNode(turn));
  updateTurnBody(turn);
  $('feed').scrollTop = $('feed').scrollHeight;
}

function renderFeed(){
  const feed = $('feed');
  feed.innerHTML = '';
  const q = (($('feedSearch') && $('feedSearch').value) || '').toLowerCase();
  const list = turns.filter(t =>
    (!favoritesOnly || t.star) &&
    (!q || (t.orig + '\n' + (t.trans || '')).toLowerCase().includes(q)));
  if(!list.length){
    const es = emptyStateNode();
    if(q || favoritesOnly) es.querySelector('h3').textContent = 'No matching turns';
    feed.appendChild(es);
    updateCount(); return;
  }
  list.forEach(t => { feed.appendChild(buildTurnNode(t)); updateTurnBody(t); });
  feed.scrollTop = feed.scrollHeight;
  updateCount();
}

function updateTurnBody(turn){
  const node = $(turn.id);
  if(!node) return;
  const slot = node.querySelector('.body-slot');
  const dst = langByCode(turn.dstCode);
  const pending = !turn.trans;
  const failed = !pending && /^⚠/.test(turn.trans);

  let html = `
    <div class="line orig">
      <span class="line-label">Said</span>
      <p class="line-text">${escapeHtml(turn.orig)}</p>
    </div>
    <div class="line trans ${pending ? 'pending' : ''} ${failed ? 'bad' : ''}">
      <span class="line-label">${dst.label}${failed ? ' · ⚠ not translated' : ''}</span>
      <p class="line-text">${pending ? 'Translating…' : escapeHtml(turn.trans)}</p>
    </div>`;

  if(turn.feedback){
    const f = turn.feedback;
    const cls = f.score >= 80 ? '' : (f.score >= 60 ? 'mid' : 'low');
    html += `
      <div class="coach">
        <div class="coach-head">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l2.4 5.2 5.6.7-4.1 3.9 1.1 5.5L12 15.6 6.9 18.3l1.1-5.5L4 8.9l5.6-.7z"/></svg>
          <span class="coach-title">Coach · in ${escapeHtml(dst.label)}</span>
          <span class="score ${cls}">${f.score}/100</span>
        </div>
        ${f.fix ? `<p class="coach-fix"><b>${escapeHtml(f.fixLabel || 'Try:')}</b>${escapeHtml(f.fix)}</p>` : ''}
        ${(f.notes || []).map(t => `<p class="coach-line note">${escapeHtml(t)}</p>`).join('')}
        ${f.gloss ? `<p class="coach-gloss">${escapeHtml(f.gloss)}</p>` : ''}
        <div class="coach-meta">
          <span>${f.wpm} wpm</span><span>${f.words} words</span>
          <span>${f.engine === 'llm' ? 'AI coach' : 'on-device coach'}</span>
        </div>
      </div>`;
  }

  if(!pending){
    html += `
      <div class="turn-actions">
        <button class="mini-btn" data-speak="${turn.id}">▶ Replay</button>
        <button class="mini-btn" data-retrans="${turn.id}">↻ Re-translate</button>
        <button class="mini-btn" data-copy="${turn.id}">Copy</button>
        <button class="mini-btn ${turn.star ? 'active' : ''}" data-star="${turn.id}">${turn.star ? '★ Starred' : '☆ Star'}</button>
        <button class="mini-btn" data-del="${turn.id}">Delete</button>
      </div>`;
  }

  slot.innerHTML = html;

  slot.querySelectorAll('[data-speak]').forEach(b =>
    b.onclick = () => speak(turn.trans, turn.dstCode, turn.id));
  slot.querySelectorAll('[data-retrans]').forEach(b =>
    b.onclick = async () => {
      b.disabled = true; const old = b.textContent; b.textContent = '↻ …';
      try {
        turn.trans = await translate(turn.orig, turn.srcCode, turn.dstCode);
        updateTurnBody(turn); saveTurns();
        toast('Re-translated', 'ok');
      } catch(e) {
        turn.trans = '⚠ Translation unavailable — check your connection or add an API key in Settings.';
        updateTurnBody(turn); saveTurns();
        toast('Re-translate failed', 'err');
      } finally { b.disabled = false; b.textContent = old; }
    });
  slot.querySelectorAll('[data-copy]').forEach(b =>
    b.onclick = async () => {
      try{ await navigator.clipboard.writeText(turn.trans); toast('Copied', 'ok'); }
      catch(e){ toast('Copy failed', 'err'); }
    });
  slot.querySelectorAll('[data-star]').forEach(b =>
    b.onclick = () => {
      turn.star = !turn.star; saveTurns();
      b.classList.toggle('active', turn.star);
      b.textContent = turn.star ? '★ Starred' : '☆ Star';
      $(turn.id)?.classList.toggle('starred', turn.star);
      if(favoritesOnly) renderFeed();
    });
  slot.querySelectorAll('[data-del]').forEach(b =>
    b.onclick = () => {
      turns = turns.filter(t => t.id !== turn.id);
      $(turn.id)?.remove(); saveTurns(); updateCount();
      if(!turns.length) $('feed').appendChild(emptyStateNode());
    });
  $('feed').scrollTop = $('feed').scrollHeight;
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

/* ------------------------- spectrum visualiser ------------------------- */
const NBARS = 68;
const bars = [];
let audioCtx = null, analyser = null, micStream = null, dataArr = null;
let phase = 0, energy = 0.12;

function buildSpectrum(){
  const g = $('spectrumGroup');
  const cx = 160, cy = 160, r0 = 104, rMax = 44;
  for(let i = 0; i < NBARS; i++){
    const a = (i / NBARS) * Math.PI * 2 - Math.PI / 2;
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const x1 = cx + Math.cos(a) * r0, y1 = cy + Math.sin(a) * r0;
    l.setAttribute('x1', x1.toFixed(1)); l.setAttribute('y1', y1.toFixed(1));
    l.setAttribute('x2', x1.toFixed(1)); l.setAttribute('y2', (y1 + 4).toFixed(1));
    g.appendChild(l);
    bars.push({ el:l, a, cx, cy, r0, rMax, v:0 });
  }
  requestAnimationFrame(tick);
}

function tick(){
  const live = $('orb').dataset.state === 'listening';
  const target = live ? (S.realMicLevels && analyser ? micEnergy() : 0.45 + Math.abs(Math.sin(phase * 1.7)) * 0.35) : 0.06;
  energy += (target - energy) * (live ? 0.22 : 0.06);
  phase += 0.035 + energy * 0.05;

  for(let i = 0; i < bars.length; i++){
    const b = bars[i];
    const wobble =
      Math.sin(phase * 2.1 + i * 0.42) * 0.42 +
      Math.sin(phase * 3.7 + i * 0.19) * 0.28 +
      Math.sin(phase * 0.9 + i * 0.77) * 0.30;
    let amp = Math.abs(wobble) * energy;
    amp = Math.min(1, amp);
    b.v += (amp - b.v) * 0.3;
    const len = 5 + b.v * b.rMax;
    const x2 = b.cx + Math.cos(b.a) * (b.r0 + len);
    const y2 = b.cy + Math.sin(b.a) * (b.r0 + len);
    b.el.setAttribute('x2', x2.toFixed(1));
    b.el.setAttribute('y2', y2.toFixed(1));
    b.el.setAttribute('opacity', (0.28 + b.v * 0.72).toFixed(2));
  }
  requestAnimationFrame(tick);
}

function micEnergy(){
  if(!analyser) return 0.2;
  analyser.getByteFrequencyData(dataArr);
  let sum = 0;
  for(let i = 0; i < dataArr.length; i++) sum += dataArr[i];
  return Math.min(1, (sum / dataArr.length) / 90);
}
async function enableMicLevels(){
  try{
    if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if(!micStream) micStream = await navigator.mediaDevices.getUserMedia({ audio:true });
    if(!analyser){
      const src = audioCtx.createMediaStreamSource(micStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      dataArr = new Uint8Array(analyser.frequencyBinCount);
      src.connect(analyser);
    }
  }catch(e){ /* fall back to synthetic */ }
}
function disableMicLevels(){
  if(micStream){ micStream.getTracks().forEach(t => t.stop()); micStream = null; analyser = null; }
}
function startMicMeter(){
  const bar = $('micMeter'); if(!bar) return;
  const tick = () => {
    let lvl = 0;
    if(analyser && dataArr){
      try{
        analyser.getByteTimeDomainData(dataArr);
        let sum = 0;
        for(let i = 0; i < dataArr.length; i++){ const v = (dataArr[i] - 128) / 128; sum += v * v; }
        lvl = Math.min(1, Math.sqrt(sum / dataArr.length) * 3.2);
      }catch(e){ lvl = 0; }
    }
    bar.style.width = (lvl * 100).toFixed(0) + '%';
    bar.dataset.live = lvl > 0.02 ? '1' : '0';
    micMeterRAF = requestAnimationFrame(tick);
  };
  cancelAnimationFrame(micMeterRAF);
  micMeterRAF = requestAnimationFrame(tick);
}
function stopMicMeter(){
  cancelAnimationFrame(micMeterRAF); micMeterRAF = null;
  const bar = $('micMeter'); if(bar){ bar.style.width = '0%'; bar.dataset.live = '0'; }
}

/* ============================================================
   DEMO (works without mic, and without network)
   ============================================================ */
const DEMO = [
  { s:'A', src:'en-US', dst:'es-ES',
    orig:'Hi! I am looking for a table for two, please. Do you have anything near the window?',
    trans:'¡Hola! Busco una mesa para dos, por favor. ¿Tienen algo cerca de la ventana?',
    fix:'Hi! I am looking for a table for two, please. Do you have anything near the window?',
    notes:['Try “Could we get a table for two?” — it sounds more natural when ordering.','Nice clear pacing and polite register.'],
    score:88 },
  { s:'B', src:'es-ES', dst:'en-US',
    orig:'Claro que sí. Tenemos una mesa junto a la ventana. ¿Les parece bien?',
    trans:'Of course. We have a table by the window. Does that work for you?',
    fix:'',
    notes:['Natural and polite — the phrasing is exactly right.'],
    score:94 },
  { s:'A', src:'en-US', dst:'es-ES',
    orig:'That is more better, thank you. Can we see the menu, and do you have any vegetarian options?',
    trans:'Eso está mucho mejor, gracias. ¿Podemos ver el menú? ¿Tienen opciones vegetarianas?',
    fix:'That is much better, thank you. Can we see the menu, and do you have any vegetarian options?',
    notes:['“More better” is a double comparative — say “much better”.','Good use of two questions in one turn; keep them joined with “and”.'],
    score:71 },
  { s:'B', src:'es-ES', dst:'en-US',
    orig:'Sí, tenemos varias opciones vegetarianas. La paella de verduras es la más popular.',
    trans:'Yes, we have several vegetarian options. The vegetable paella is the most popular.',
    fix:'',
    notes:['Excellent — “the most popular” is the correct superlative form.'],
    score:96 },
];

async function runDemo(){
  if(demoRunning) return;
  demoRunning = true;
  $('demoBtn').classList.add('is-active');
  setOrbState('working');
  for(const d of DEMO){
    if(!demoRunning) break;
    const turn = {
      id:'d' + Math.random().toString(36).slice(2,7),
      speaker:d.s, srcCode:d.src, dstCode:d.dst,
      orig:d.orig, trans:d.trans, demo:true,
      ts:new Date(), ms:4200,
      feedback:{ score:d.score, fixLabel: (langByCode(d.dst).base === 'es' ? 'Una forma más natural de decirlo:' : 'A more natural way to say it:'),
                 fix:d.fix, notes:d.notes, gloss:'Scripted demo turn', wpm:132, words:d.orig.split(' ').length, engine:'local' },
    };
    turns.push(turn);
    renderTurn(turn);
    updateCount();
    saveTurns();
    setCaption(d.orig);
    await new Promise(r => setTimeout(r, 900));
    if(S.autoSpeak) await speak(d.trans, d.dst, turn.id);
    await new Promise(r => setTimeout(r, 500));
  }
  demoRunning = false;
  $('demoBtn').classList.remove('is-active');
  setOrbState(listening ? 'listening' : 'idle');
  setCaption('');
}

/* ============================================================
   EXPORT
   ============================================================ */
function exportTranscript(){
  if(!turns.length){ toast('Nothing to export yet', 'err'); return; }
  let md = '# LinguaPulse transcript\n\n' + new Date().toLocaleString() + '\n\n';
  for(const t of turns){
    const src = langByCode(t.srcCode), dst = langByCode(t.dstCode);
    md += `## Speaker ${t.speaker} · ${src.label} → ${dst.label} · ${t.ts.toLocaleTimeString()}\n\n`;
    md += `- **Said:** ${t.orig}\n- **${dst.label}:** ${t.trans || '(no translation)'}\n`;
    if(t.feedback){
      md += `- **Coach (${t.score}/100):**\n`;
      if(t.feedback.fix) md += `  - Better: ${t.feedback.fix}\n`;
      (t.feedback.notes || []).forEach(nn => md += `  - ${nn}\n`);
    }
    md += '\n';
  }
  const blob = new Blob([md], { type:'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'linguapulse-transcript-' + Date.now() + '.md';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Transcript exported', 'ok');
}

/* ============================================================
   UI WIRING
   ============================================================ */
function paintLangChips(){
  const a = langMeta(S.langA), b = langMeta(S.langB);
  $('flagA').textContent = a.flag; $('labelA').textContent = a.label;
  $('flagB').textContent = b.flag; $('labelB').textContent = b.label;
  markSpeakingChip();
}

function openLangPicker(slot){
  const modal = $('langModal');
  $('langModalTitle').textContent = 'Language for speaker ' + slot;
  $('langSearch').value = '';
  const list = $('langList');
  const current = slot === 'A' ? S.langA : S.langB;
  const draw = filter => {
    list.innerHTML = '';
    const all = [AUTO, ...LANGS].filter(l => l.label.toLowerCase().includes(filter.toLowerCase()));
    all.forEach(l => {
        const b = el('button', 'lang-item' + (l.code === current ? ' selected' : ''));
        b.innerHTML = `<span class="li-flag">${l.flag}</span><span class="li-name">${l.label}</span>`;
        b.onclick = () => {
          if(slot === 'A') S.langA = l.code; else S.langB = l.code;
          currentSpeaker = slot;            // tapping a side claims the floor for that speaker
          saveSettings(); paintLangChips(); buildLangSelects();
          if(listening && recog) recog.lang = recogLangHint(currentSpeaker);
          modal.hidden = true;
        };
        list.appendChild(b);
      });
  };
  draw('');
  $('langSearch').oninput = e => draw(e.target.value);
  $('langSearch').addEventListener('keydown', e => {
    if(e.key === 'Enter' || e.key === 'Return'){
      const first = list.querySelector('.lang-item');
      if(first) first.click();
    }
  });
  $('langSearch').focus();
  modal.hidden = false;
}

function buildLangSelects(){
  const a = $('langASelect'), b = $('langBSelect');
  a.innerHTML = b.innerHTML = '';
  const opts = [AUTO, ...LANGS];
  opts.forEach(l => {
    const o1 = document.createElement('option'); o1.value = l.code; o1.textContent = l.label;
    const o2 = o1.cloneNode(true);
    a.appendChild(o1); b.appendChild(o2);
  });
  a.value = S.langA; b.value = S.langB;
}

function openSettings(){
  $('providerSelect').value = S.provider;
  $('baseUrlInput').value = S.baseUrl;
  $('modelInput').value = S.model;
  $('apiKeyInput').value = S.apiKey;
  $('feedbackStyleSelect').value = S.feedbackStyle;
  $('ttsRateSelect').value = S.ttsRate;
  $('micLevelsCheck').checked = !!S.realMicLevels;
  $('silenceSelect').value = String(S.silenceMs || 900);
  $('micEnabledCheck').checked = (S.micEnabled !== false);
  $('llmFields').hidden = S.provider !== 'openai';
  $('accentSelect').value = S.accent || 'aurora';
  $('googleClientId').value = ssoClientId('google');
  $('appleClientId').value = ssoClientId('apple');
  $('githubClientId').value = ssoClientId('github');
  $('discordClientId').value = ssoClientId('discord');
  $('githubProxy').value = S.githubProxy || '';
  buildLangSelects();
  applyMicEnabled();
  refreshMicPerm();
  refreshSSOButtons();
  $('settingsModal').hidden = false;
}

function wire(){
  $('micBtn').onclick = () => listening ? stopListening() : startListening();

  $('langA').onclick = () => openLangPicker('A');
  $('langB').onclick = () => openLangPicker('B');
  $('swapBtn').onclick = e => {
    const t = S.langA; S.langA = S.langB; S.langB = t;
    currentSpeaker = currentSpeaker === 'A' ? 'B' : 'A';
    saveSettings(); paintLangChips();
    if(listening && recog) recog.lang = recogLangHint(currentSpeaker);
    const btn = e && e.currentTarget;
    if(btn){ btn.classList.add('spin'); setTimeout(() => btn.classList.remove('spin'), 260); }
  };

  const bindToggle = (id, key) => {
    const b = $(id);
    b.onclick = () => { S[key] = !S[key]; b.dataset.on = S[key]; b.classList.toggle('is-on', S[key]); saveSettings(); };
    b.dataset.on = S[key]; b.classList.toggle('is-on', S[key]);
  };
  bindToggle('autoSpeakToggle', 'autoSpeak');
  bindToggle('autoTurnToggle', 'autoTurn');
  bindToggle('coachToggle', 'coach');

  $('micEnabledCheck').onchange = e => { S.micEnabled = e.target.checked; saveSettings(); applyMicEnabled(); };
  $('micRequestBtn').onclick = requestMicPermission;

  $('clearBtn').onclick = () => {
    turns = []; $('feed').innerHTML = '';
    $('feed').appendChild(emptyStateNode());
    updateCount(); saveTurns(); toast('Conversation cleared');
  };

  $('demoBtn').onclick = $('demoBtn2').onclick = () => demoRunning ? (demoRunning = false) : runDemo();
  $('exportBtn').onclick = exportTranscript;
  $('shareBtn').onclick = shareTranscript;

  $('themeBtn').onclick = toggleTheme;
  $('feedSearch').oninput = () => renderFeed();
  $('favFilter').onclick = () => {
    favoritesOnly = !favoritesOnly;
    $('favFilter').classList.toggle('active', favoritesOnly);
    renderFeed();
  };

  $('settingsBtn').onclick = openSettings;
  $('closeSettings').onclick = () => $('settingsModal').hidden = true;
  $('closeLang').onclick = () => $('langModal').hidden = true;
  $('providerSelect').onchange = e => { $('llmFields').hidden = e.target.value !== 'openai'; };
  $('testTransBtn').onclick = async e => {
    const btn = e.currentTarget, res = $('testTransResult');
    btn.disabled = true; res.textContent = 'Testing…'; res.className = 'test-result';
    try {
      const src = (S.langA && S.langA !== 'auto') ? S.langA : 'en-US';
      const dst = (S.langB && S.langB !== 'auto') ? S.langB : 'es-ES';
      const out = await translate('Hello, how are you today?', src, dst);
      res.textContent = '✓ ' + out;
      res.className = 'test-result ok';
    } catch(err) {
      res.textContent = '✗ ' + (err.message || 'failed');
      res.className = 'test-result err';
    } finally { btn.disabled = false; }
  };
  $('ttsRateSelect').onchange = e => { S.ttsRate = parseFloat(e.target.value) || 1; saveSettings(); };
  $('settingsForm').addEventListener('submit', e => {
    e.preventDefault();
    S.provider = $('providerSelect').value;
    S.baseUrl = $('baseUrlInput').value.trim() || DEFAULT_SETTINGS.baseUrl;
    S.model = $('modelInput').value.trim() || DEFAULT_SETTINGS.model;
    S.apiKey = $('apiKeyInput').value.trim();
    S.feedbackStyle = $('feedbackStyleSelect').value;
    S.realMicLevels = $('micLevelsCheck').checked;
    S.silenceMs = parseInt($('silenceSelect').value, 10) || 900;
    S.langA = $('langASelect').value;
    S.langB = $('langBSelect').value;
    S.accent = $('accentSelect').value;
    S.googleClientId = $('googleClientId').value.trim();
    S.appleClientId = $('appleClientId').value.trim();
    S.githubClientId = $('githubClientId').value.trim();
    S.discordClientId = $('discordClientId').value.trim();
    S.githubProxy = $('githubProxy').value.trim();
    saveSettings(); paintLangChips(); applyAccent(); refreshSSOButtons();
    $('settingsModal').hidden = true;
    toast('Settings saved', 'ok');
  });
  $('accentSelect').onchange = e => { S.accent = e.target.value; saveSettings(); applyAccent(); };
  // choosing a language in Settings applies it right away (no need to find Save)
  $('langASelect').addEventListener('change', () => { S.langA = $('langASelect').value; saveSettings(); paintLangChips(); });
  $('langBSelect').addEventListener('change', () => { S.langB = $('langBSelect').value; saveSettings(); paintLangChips(); });
  $('resetBtn').onclick = () => {
    S = Object.assign({}, DEFAULT_SETTINGS);
    saveSettings(); paintLangChips(); applyMicEnabled(); openSettings();
    toast('Reset to defaults');
  };

  document.querySelectorAll('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', e => { if(e.target === bd) bd.hidden = true; });
  });

  // ---- keyboard shortcuts (desktop-friendly) ----
  const isTyping = () => { const t = document.activeElement; return t && /INPUT|SELECT|TEXTAREA/.test(t.tagName); };
  document.addEventListener('keydown', e => {
    const ae = document.activeElement;
    if(e.key === 'Escape'){ $('settingsModal').hidden = true; $('langModal').hidden = true; return; }
    if(isTyping()) return;
    if(e.code === 'Space' && ae.tagName !== 'BUTTON'){
      e.preventDefault(); listening ? stopListening() : startListening();
    } else if(e.key === 's' || e.key === 'S'){ $('swapBtn').click(); }
    else if(e.key === 't' || e.key === 'T'){ $('themeBtn').click(); }
    else if(e.key === 'd' || e.key === 'D'){ if(!demoRunning) $('demoBtn').click(); }
  });

  // ---- PWA install ----
  let deferredPrompt = null;
  const installBtn = $('installBtn');
  if(installBtn){
    if(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) installBtn.hidden = true;
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      deferredPrompt = e;
      installBtn.hidden = false;
    });
    installBtn.addEventListener('click', async () => {
      if(!deferredPrompt) return;
      deferredPrompt.prompt();
      try{ const { outcome } = await deferredPrompt.userChoice; if(outcome === 'accepted') toast('Installing LinguaPulse…','ok'); }
      catch(err){ /* user dismissed — no-op */ }
      deferredPrompt = null;
      installBtn.hidden = true;
    });
    window.addEventListener('appinstalled', () => { installBtn.hidden = true; toast('LinguaPulse installed','ok'); });
  }

  applyMicEnabled();
  refreshMicPerm();
}

function emptyStateNode(){
  const n = el('div', 'empty-state');
  n.id = 'emptyState';
  n.innerHTML = `
    <div class="es-rings"><span></span><span></span><span></span></div>
    <h3>No turns yet</h3>
    <p>Hit the orb and start talking. Each turn shows what you said, the translation, and coaching feedback written in the language you're translating <em>into</em>.</p>
    <button class="ghost-btn" id="demoBtn2">Run a demo conversation</button>`;
  n.querySelector('#demoBtn2').onclick = () => demoRunning ? (demoRunning = false) : runDemo();
  return n;
}

/* ------------------------- boot ------------------------- */
/* ============================================================
   ACCOUNTS / AUTH / PROFILE  (local, no backend)
   - accounts + session stored in localStorage
   - passwords hashed with SHA-256 (SubtleCrypto); never stored in plaintext
   - guest mode (lp_guest flag) keeps the app usable without an account
   ============================================================ */
/* loadAccounts / saveAccounts are defined in the persistence section (encrypted + sanitised). */
function getSessionId(){ try{ return localStorage.getItem('lp_session'); }catch(e){ return null; } }
function setSessionId(id){ try{ localStorage.setItem('lp_session', id); }catch(e){} }
function clearSessionId(){ try{ localStorage.removeItem('lp_session'); }catch(e){} }
function currentAccount(){ const id=getSessionId(); if(!id) return null; return loadAccounts().find(a=>a.id===id) || null; }

async function hashPass(str){
  try{ if(crypto && crypto.subtle){ const buf=await crypto.subtle.digest('SHA-256', new TextEncoder().encode('lp.v1:'+str)); return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join(''); } }catch(e){}
  // Non-secure-context fallback: Web Crypto is unavailable, so we can't use SHA-256/PBKDF2.
  // Salt with a per-device random value so identical passwords don't yield identical hashes
  // across devices, and so they aren't directly searchable. (Accounts should be created on
  // https/localhost where the strong SHA-256 path is used.)
  const salt = await pwSalt();
  let h=5381; const s='lp.fb:'+salt+':'+str; for(let i=0;i<s.length;i++){ h=((h<<5)+h+s.charCodeAt(i))>>>0; } return 'fb_'+h.toString(16);
}
async function pwSalt(){
  let s=null; try{ s=localStorage.getItem('lp_pwsalt'); }catch(e){}
  if(!s){ s=bytesToHex(crypto.getRandomValues(new Uint8Array(16))); try{ localStorage.setItem('lp_pwsalt', s); }catch(e){} }
  return s;
}

async function signUp({name,email,password}){
  email=(email||'').trim().toLowerCase();
  if(!name||!name.trim()) return {ok:false,error:'Please enter your name.'};
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return {ok:false,error:'Please enter a valid email.'};
  if(!password||password.length<6) return {ok:false,error:'Password must be at least 6 characters.'};
  const accounts=loadAccounts();
  if(accounts.some(a=>a.email===email)) return {ok:false,error:'An account with that email already exists.'};
  const salt = bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
  const id='u'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
  const acc={ id, name:name.trim(), email,
    passHash:await hashPass(password), avatar:'', createdAt:Date.now(), prefs:accountPrefs(),
    salt, iter: PBKDF2_ITER };
  // derive the password-derived data key and seed an (empty) history encrypted under it
  if(HAS_SUBTLE){ sessionDataKey = await deriveDataKey(password, salt, PBKDF2_ITER); }
  accounts.push(acc); await saveAccounts(accounts); setSessionId(acc.id);
  await encStore(historyKey(), [], sessionDataKey || undefined);   // key: password-derived when available, else device key
  return {ok:true,acc};
}

async function login({email,password}){
  email=(email||'').trim().toLowerCase();
  const acc=loadAccounts().find(a=>a.email===email);
  if(!acc) return {ok:false,error:'No account found for that email.'};
  const h=await hashPass(password);
  if(h!==acc.passHash) return {ok:false,error:'Incorrect password.'};
  // derive the per-account data key (password-derived). It lives only in memory and is required to read history.
  if(HAS_SUBTLE && acc.salt && acc.iter){
    try{ sessionDataKey = await deriveDataKey(password, acc.salt, acc.iter); }
    catch(e){ sessionDataKey = null; return {ok:false,error:'Could not unlock your data — please try again.'}; }
  } else {
    sessionDataKey = null;   // legacy / non-secure context: falls back to device key
  }
  setSessionId(acc.id);
  return {ok:true,acc};
}

function deleteAccount(){
  const id=getSessionId(); if(!id) return;
  saveAccounts(loadAccounts().filter(a=>a.id!==id));
  clearSessionId(); sessionDataKey=null; try{ localStorage.removeItem('lp_guest'); }catch(e){}
  toast('Account deleted','ok'); showAuth();
}
function logout(){
  clearSessionId(); sessionDataKey=null; try{ localStorage.removeItem('lp_guest'); }catch(e){}
  turns = []; renderFeed();
  toast('Logged out'); showAuth();
}

function applyAccountToSettings(acc){
  // Keep the in-memory API key (from the device-keyed global settings) and layer the
  // account's non-secret prefs on top — the account record never stores the API key.
  S=Object.assign({},DEFAULT_SETTINGS,S,acc.prefs||{});
  saveSettings();
  paintLangChips();
  if($('langASelect')) buildLangSelects();
  syncToggleUI();
  updateProfileDot();
}
function syncToggleUI(){
  [['autoSpeakToggle','autoSpeak'],['autoTurnToggle','autoTurn'],['coachToggle','coach']].forEach(([id,key])=>{
    const b=$(id); if(!b) return; b.dataset.on=S[key]; b.classList.toggle('is-on',!!S[key]);
  });
}
function updateProfileDot(){
  const d=$('profileDot'); if(!d) return; const acc=currentAccount();
  if(!acc){ d.textContent='LP'; return; }
  d.textContent=acc.avatar || (acc.name||'?').trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase() || 'LP';
}
function showAuthTab(which){
  const login=which!=='signup';
  $('loginForm').hidden=!login; $('signupForm').hidden=login;
  $('tabLogin').classList.toggle('active',login); $('tabSignup').classList.toggle('active',!login);
  $('loginErr').textContent=''; $('signErr').textContent='';
  const f = login ? $('loginEmail') : $('signName');
  if(f) setTimeout(() => { try{ f.focus(); }catch(e){} }, 0);
}

/* device-wide usage stats — shown on the login screen so returning /
   guest users see their activity before signing in. Reads every
   lp_stats_* summary bucket (guest + each account) — these are content-free
   (counts + language codes + activity days only), so no conversation text
   is exposed on the pre-login screen. */
function computeDeviceStats(){
  let turns = 0;
  const langs = new Set(), days = new Set();
  try{
    for(let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      if(!k || !k.startsWith('lp_stats_')) continue;
      const s = JSON.parse(localStorage.getItem(k) || '{}');
      turns += Number(s.turns) || 0;
      (Array.isArray(s.langs) ? s.langs : []).forEach(c => langs.add(c));
      (Array.isArray(s.days)  ? s.days  : []).forEach(d => days.add(d));
    }
  }catch(e){}
  let streak = 0;
  if(days.size){
    const has = d => days.has(d);
    const dk  = d => d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
    const cur = new Date();
    if(!has(dk(cur))){ cur.setDate(cur.getDate()-1); if(!has(dk(cur))) streak = 0; else streak = 1; }
    else streak = 1;
    while(has(dk(cur))){ streak++; cur.setDate(cur.getDate()-1); }
  }
  return { turns, langs: langs.size, streak };
}
function renderAuthStats(){
  const box = $('authStats'); if(!box) return;
  const { turns, langs, streak } = computeDeviceStats();
  if(turns === 0){ box.hidden = true; return; }
  box.hidden = false;
  const t = $('authTurns'), l = $('authLangs'), s = $('authStreak');
  if(t) t.textContent = turns; if(l) l.textContent = langs; if(s) s.textContent = streak;
}

function showAuth(){ const a=$('authScreen'); if(a) a.hidden=false; renderAuthStats(); }
function hideAuth(){ const a=$('authScreen'); if(a) a.hidden=true; }

function showHistoryLock(){
  const b=$('historyLock'); if(!b) return;
  b.hidden=false;
  const btn=$('unlockHistoryBtn'); if(btn) btn.onclick=()=>{ const acc=currentAccount(); showAuth(); showAuthTab('login'); const le=$('loginEmail'); if(le && acc) le.value=acc.email; };
}
function hideHistoryLock(){ const b=$('historyLock'); if(b) b.hidden=true; }

function onSignedIn(acc){
  applyAccountToSettings(acc);
  try{ localStorage.removeItem('lp_guest'); }catch(e){}
  historyLocked = false; hideHistoryLock();
  hideAuth();
  loadContextHistory();
  toast('Welcome, '+(acc.name.split(' ')[0]||'there')+'!','ok');
}

function initAuth(){
  $('tabLogin').onclick=()=>showAuthTab('login');
  $('tabSignup').onclick=()=>showAuthTab('signup');

  $('loginForm').addEventListener('submit', async e=>{
    e.preventDefault();
    const r=await login({email:$('loginEmail').value,password:$('loginPass').value});
    if(!r.ok){ $('loginErr').textContent=r.error; return; }
    $('loginForm').reset(); onSignedIn(r.acc);
  });
  $('signupForm').addEventListener('submit', async e=>{
    e.preventDefault();
    if($('signPass').value!==$('signPass2').value){ $('signErr').textContent='Passwords do not match.'; return; }
    const r=await signUp({name:$('signName').value,email:$('signEmail').value,password:$('signPass').value});
    if(!r.ok){ $('signErr').textContent=r.error; return; }
    $('signupForm').reset(); onSignedIn(r.acc);
  });
  $('guestBtn').onclick=()=>{ try{ localStorage.setItem('lp_guest','1'); }catch(e){} clearSessionId(); sessionDataKey=null; hideAuth(); loadContextHistory(); toast('Continuing as guest'); };
  $('profileBtn').onclick=openProfile;
  $('closeProfile').onclick=()=>{ $('profileModal').hidden=true; };
  $('profileModal').addEventListener('click', e=>{ if(e.target===$('profileModal')) $('profileModal').hidden=true; });
  // SSO / passkey buttons
  ['google','apple','github','discord'].forEach(p=>{
    const btn=$('sso'+p.charAt(0).toUpperCase()+p.slice(1));
    if(btn) btn.onclick=()=>handleSSO(p);
  });
  $('ssoPasskey').onclick=()=>{ const acc=currentAccount(); if(acc) passkeyRegister(); else passkeyLogin(); };
  refreshSSOButtons();
}

async function switchAccount(id){
  const acc=loadAccounts().find(a=>a.id===id); if(!acc) return;
  // Password accounts need re-auth (their history key is password-derived).
  if(acc.passHash && acc.salt && acc.iter){
    $('profileModal').hidden=true; showAuth(); showAuthTab('login');
    const le=$('loginEmail'); if(le) le.value=acc.email;
    toast('Sign in to switch to '+acc.email,'ok'); return;
  }
  setSessionId(acc.id); sessionDataKey=null;
  await saveAccounts(loadAccounts());
  $('profileModal').hidden=true; onSignedIn(acc);
}
function openProfile(){
  const acc=currentAccount(); const body=$('profileBody'); const foot=$('profileFoot');
  if(!acc){
    body.innerHTML=`<div class="profile-guest"><p>You're using LinguaPulse as a <strong>guest</strong>. Create a free account to save your languages and settings on this device.</p><button class="primary-btn" id="profileCreate" type="button">Create account</button></div>`;
    foot.innerHTML='';
    $('profileCreate').onclick=()=>{ $('profileModal').hidden=true; showAuth(); showAuthTab('signup'); };
    $('profileModal').hidden=false; return;
  }
  const initials=(acc.name||'?').trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase()||'LP';
  const avatars=['😀','🌟','🦊','🐼','🚀','🌈','🎧','🗣️','💡','🔥','🌍','🧠','🍀','🐙','🌸','⚡','🎯','🌙'];
  const realTurns = turns.filter(t=>!t.demo);
  const statTurns = realTurns.length;
  const statLangs = new Set(realTurns.map(t=>t.srcCode)).size;
  const statStreak = computeStreak(turns);
  const ms=(acc.methods||[]).slice(); if(acc.passHash) ms.unshift('password');
  const methodsHtml='<div class="method-chips">'+(ms.length?ms.map(m=>'<span class="method-chip">'+(m==='password'?'🔑 Password':providerLabel(m))+'</span>').join(''):'<span class="method-chip muted">no linked methods</span>')+'</div>';
  const others=loadAccounts().filter(a=>a.id!==acc.id);
  const accountsHtml=others.length?('<div class="field"><label>Accounts on this device</label><div class="acct-list">'+others.map(o=>{ const pwd=(o.passHash&&o.salt&&o.iter); return '<div class="acct-row"><span class="acct-name">'+escapeHtml(o.email)+'</span><button class="ghost-btn sm" data-acct="'+escapeAttr(o.id)+'" type="button">'+(pwd?'Sign in':'Switch')+'</button></div>'; }).join('')+'</div></div>'):'';
  body.innerHTML=`
    <div class="profile-top">
      <div class="profile-avatar" id="pAvatar">${acc.avatar||initials}</div>
      <div><strong>${escapeHtml(acc.name)}</strong><small>${escapeHtml(acc.email)}</small></div>
    </div>
    <div class="field"><label>Display name</label><input id="pName" type="text" value="${escapeAttr(acc.name)}"></div>
    <div class="field"><label>Avatar</label><div class="avatar-picker" id="pAvatars"></div></div>
    <div class="field"><label>Linked sign-in methods</label>${methodsHtml}
      <button class="ghost-btn sm" id="pAddPasskey" type="button">＋ Add passkey</button></div>
    <div class="field"><label>Preferred language A</label><select id="pLangA"></select></div>
    <div class="field"><label>Preferred language B</label><select id="pLangB"></select></div>
    ${accountsHtml}
    <div class="profile-stats">
      <div><strong>${statTurns}</strong><span>turns</span></div>
      <div><strong>${statLangs}</strong><span>languages</span></div>
      <div><strong>${statStreak}</strong><span>day streak</span></div>
    </div>`;
  const picker=$('pAvatars'); let chosen=acc.avatar||'';
  avatars.forEach(em=>{ const b=el('button','av-opt'+(em===chosen?' selected':''),em); b.type='button';
    b.onclick=()=>{ chosen=em; picker.querySelectorAll('.av-opt').forEach(x=>x.classList.remove('selected')); b.classList.add('selected'); $('pAvatar').textContent=em; }; picker.appendChild(b); });
  const a=$('pLangA'),b=$('pLangB');
  [AUTO, ...LANGS].forEach(l=>{ a.appendChild(new Option(l.label,l.code)); b.appendChild(new Option(l.label,l.code)); });
  a.value=S.langA; b.value=S.langB;
  foot.innerHTML=`<button class="ghost-btn danger" id="pDelete" type="button">Delete account</button>
    <div style="display:flex;gap:8px"><button class="ghost-btn" id="pLogout" type="button">Log out</button><button class="primary-btn" id="pSave" type="button">Save</button></div>`;
  $('pSave').onclick=()=>{
    acc.name=$('pName').value.trim()||acc.name; acc.avatar=chosen;
    S.langA=$('pLangA').value; S.langB=$('pLangB').value;
    acc.prefs=accountPrefs();   // secret-free; API key stays in device settings only
    saveAccounts(loadAccounts().map(x=>x.id===acc.id?acc:x));
    saveSettings(); paintLangChips(); buildLangSelects(); updateProfileDot();
    $('profileModal').hidden=true; toast('Profile saved','ok');
  };
  $('pLogout').onclick=()=>{ $('profileModal').hidden=true; logout(); };
  $('pDelete').onclick=()=>{ if(confirm('Delete your account? This removes it from this device and cannot be undone.')){ $('profileModal').hidden=true; deleteAccount(); } };
  const addPk=$('pAddPasskey'); if(addPk) addPk.onclick=()=>passkeyRegister();
  document.querySelectorAll('.acct-row button[data-acct]').forEach(btn=>{ btn.onclick=()=>switchAccount(btn.getAttribute('data-acct')); });
  $('profileModal').hidden=false;
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s){ return escapeHtml(s); }

/* ============================================================
   SSO (Google / Apple / GitHub / Discord) + Passkey (WebAuthn)
   ------------------------------------------------------------
   No backend is involved. Google & Discord use the OAuth2 implicit
   (token) redirect flow; the provider redirects back to our same-origin
   oauth-callback.html which posts the token to the opener (no third-party
   script is ever loaded, so our strict CSP is preserved). GitHub uses the
   device flow (no client secret needed). Apple uses code+id_token; the
   id_token is decoded when the provider returns it. Passkeys use the
   platform WebAuthn API (resident credentials) — fully working with zero
   configuration. SSO/passkey history is device-key encrypted.
   ============================================================ */
function providerLabel(p){ return { google:'Google', apple:'Apple', github:'GitHub', discord:'Discord', passkey:'Passkey' }[p] || p; }
function ssoClientId(p){ return (S[p + 'ClientId'] || '').trim(); }
function oauthRedirectUri(){ return location.origin + location.pathname.replace(/[^/]*$/, '') + 'oauth-callback.html'; }
function bytesToB64url(buf){ let s=''; const b=new Uint8Array(buf); for(let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function b64urlToBytes(s){ s=s.replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4) s+='='; const bin=atob(s); const a=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i); return a; }
function randB64url(n){ return bytesToB64url(crypto.getRandomValues(new Uint8Array(n))); }
function avatarForProfile(p){ const set=['😀','🌟','🦊','🐼','🚀','🌈','🎧','🗣️','💡','🔥','🌍','🧠','🍀','🐙']; let h=0; const str=(p&&p.email)||'x'; for(let i=0;i<str.length;i++) h=(h*31+str.charCodeAt(i))>>>0; return set[h%set.length]; }
function decodeJwt(idToken){
  try{ const parts=idToken.split('.'); if(parts.length<2) return null; let p=parts[1].replace(/-/g,'+').replace(/_/g,'/'); while(p.length%4) p+='='; return JSON.parse(decodeURIComponent(escape(atob(p)))); }
  catch(e){ return null; }
}
async function handleSSO(provider){
  if(provider === 'passkey'){ return passkeyLogin(); }
  const id = ssoClientId(provider);
  if(!id){ toast('Add your '+providerLabel(provider)+' client ID in Settings first','err'); openSettings(); return; }
  if(provider === 'github'){ return githubDeviceFlow(id); }
  const state = randB64url(16);
  const params = new URLSearchParams();
  params.set('client_id', id); params.set('redirect_uri', oauthRedirectUri()); params.set('state', state);
  let authUrl;
  if(provider === 'google'){ params.set('response_type','token'); params.set('scope','openid email profile'); params.set('nonce', randB64url(16)); authUrl='https://accounts.google.com/o/oauth2/v2/auth?'+params.toString(); }
  else if(provider === 'discord'){ params.set('response_type','token'); params.set('scope','identify email'); authUrl='https://discord.com/oauth2/authorize?'+params.toString(); }
  else if(provider === 'apple'){ params.set('response_type','code id_token'); params.set('response_mode','fragment'); params.set('scope','name email'); authUrl='https://appleid.apple.com/auth/authorize?'+params.toString(); }
  const popup = window.open(authUrl, 'lp_oauth', 'width=480,height=680');
  if(!popup){ toast('Popup blocked — please allow pop-ups for this site','err'); return; }
  const result = await new Promise(res => {
    let done=false; const finish=r=>{ if(done) return; done=true; res(r); };
    const onMsg=ev=>{ if(ev.origin!==location.origin) return; const d=ev.data||{}; if(d.type==='lp_oauth'){ window.removeEventListener('message',onMsg); finish(d); } };
    window.addEventListener('message', onMsg);
    const iv=setInterval(()=>{ if(popup.closed){ clearInterval(iv); window.removeEventListener('message',onMsg); finish({error:'popup_closed'}); } }, 400);
  });
  if(result.error==='popup_closed'){ toast('Sign-in cancelled','err'); return; }
  if(result.error){ toast(providerLabel(provider)+' sign-in failed: '+(result.error_description||result.error),'err'); return; }
  if(result.state && result.state!==state){ toast('Sign-in state mismatch — aborted for security','err'); return; }
  let profile=null;
  try{
    if(provider==='google'){
      const info=await (await fetch('https://oauth2.googleapis.com/tokeninfo?access_token='+encodeURIComponent(result.access_token))).json();
      if(!info.email) throw new Error('No email returned');
      profile={ email:info.email, name:info.name||info.email.split('@')[0], sub:info.sub||info.email };
    } else if(provider==='discord'){
      const me=await (await fetch('https://discord.com/api/users/@me',{headers:{Authorization:'Bearer '+result.access_token}})).json();
      profile={ email:me.email||(me.username+'@discord'), name:me.global_name||me.username||me.email, sub:me.id };
    } else if(provider==='apple'){
      if(result.id_token){ const jwt=decodeJwt(result.id_token); if(jwt&&jwt.email){ const nm=(jwt.name&&((jwt.name.firstName||'')+' '+(jwt.name.lastName||'')).trim())||''; profile={ email:jwt.email, name:nm||jwt.email.split('@')[0], sub:jwt.sub }; } }
      if(!profile){ toast('Apple returned only an authorization code — its web flow needs the JS SDK or a backend to expose the id_token. Google / Discord / Passkey work with no backend.','err'); return; }
    }
  }catch(e){ toast('Could not verify '+providerLabel(provider)+' sign-in: '+(e.message||'error'),'err'); return; }
  if(!profile||!profile.email){ toast('Sign-in did not return an email','err'); return; }
  await finishSSO(provider, profile);
}
async function githubDeviceFlow(clientId){
  // GitHub's device/token endpoints deliberately send NO CORS headers, so a direct
  // browser fetch is blocked. A same-origin proxy (e.g. a Netlify/Vercel function that
  // forwards to github.com) is required — set its base URL in Settings (githubProxy).
  const gh = (p) => {
    const base = (S.githubProxy || '').trim().replace(/\/+$/, '');
    return base ? base + p : 'https://github.com' + p;
  };
  try{
    toast('Starting GitHub device sign-in…');
    const init=await (await fetch(gh('/login/device/code'),{ method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'}, body:new URLSearchParams({client_id:clientId,scope:'read:user user:email'}).toString() })).json();
    if(!init.device_code) throw new Error(init.error_description||init.error||'no device code');
    if(navigator.clipboard) try{ await navigator.clipboard.writeText(init.user_code); }catch(e){}
    toast('GitHub: enter code '+init.user_code+' on '+init.verification_uri+' (copied)', 'ok');
    const deadline=Date.now()+(parseInt(init.expires_in,10)||900)*1000;
    while(Date.now()<deadline){
      await new Promise(r=>setTimeout(r,(parseInt(init.interval,10)||5)*1000));
      const tok=await (await fetch(gh('/login/oauth/access_token'),{ method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'}, body:new URLSearchParams({client_id:clientId,device_code:init.device_code,grant_type:'urn:ietf:params:oauth:grant-type:device'}).toString() })).json();
      if(tok.access_token){
        const me=await (await fetch('https://api.github.com/user',{headers:{Authorization:'Bearer '+tok.access_token,Accept:'application/vnd.github+json'}})).json();
        let email=me.email;
        if(!email){ try{ const em=await (await fetch('https://api.github.com/user/emails',{headers:{Authorization:'Bearer '+tok.access_token,Accept:'application/vnd.github+json'}})).json(); const prim=(Array.isArray(em)?em:[]).find(e=>e.primary)||(Array.isArray(em)?em[0]:null); email=prim&&prim.email; }catch(e){} }
        await finishSSO('github',{ email:email||(me.login+'@users.noreply.github.com'), name:me.name||me.login, sub:String(me.id) });
        return;
      }
      if(tok.error && tok.error!=='authorization_pending' && tok.error!=='slow_down') throw new Error(tok.error_description||tok.error);
    }
    toast('GitHub device sign-in timed out','err');
  }catch(e){ toast('GitHub sign-in failed: '+(e.message||'error')+' — a CORS proxy must be configured in Settings', 'err'); }
}
async function finishSSO(provider, profile){
  const email=(profile.email||'').trim().toLowerCase();
  if(!email){ toast('No email from provider','err'); return; }
  let acc=loadAccounts().find(a=>a.email.toLowerCase()===email);
  if(!acc){
    const id='u'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
    acc={ id, name:profile.name||email.split('@')[0], email, passHash:'', avatar:avatarForProfile(profile), createdAt:Date.now(), prefs:accountPrefs(), salt:'', iter:0, methods:[provider] };
    const accounts=loadAccounts(); accounts.push(acc); await saveAccounts(accounts);
  } else {
    acc.methods=acc.methods||[]; if(!acc.methods.includes(provider)) acc.methods.push(provider);
  }
  setSessionId(acc.id); sessionDataKey=null;   // SSO → device-key-encrypted history
  await saveAccounts(loadAccounts().map(a=>a.id===acc.id?acc:a));
  onSignedIn(acc);
}

/* ---- Passkey (WebAuthn) ---- */
async function passkeySupported(){ return !!(navigator.credentials && window.PublicKeyCredential && HAS_SUBTLE && window.isSecureContext); }
async function passkeyRegister(){
  if(!await passkeySupported()){ toast('Passkeys need a secure context (https/localhost) and a recent browser','err'); return; }
  const email=(window.prompt('Email for this passkey account:')||'').trim();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ if(email) toast('Enter a valid email','err'); return; }
  const userId=crypto.getRandomValues(new Uint8Array(16));
  const userIdB64=bytesToB64url(userId);
  const challenge=bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
  let cred;
  try{
    cred=await navigator.credentials.create({ publicKey:{
      challenge:b64urlToBytes(challenge), rp:{name:'LinguaPulse',id:location.hostname},
      user:{id:userId,name:email,displayName:email},
      pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],
      authenticatorSelection:{residentKey:'preferred',userVerification:'preferred'},
      attestation:'none', timeout:60000,
    }});
  }catch(e){ toast('Passkey registration cancelled or blocked','err'); return; }
  const credId=bytesToB64url(cred.rawId);
  const acc0=loadAccounts().find(a=>a.email.toLowerCase()===email.toLowerCase());
  let acc=acc0;
  if(!acc){
    const id='u'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
    acc={ id, name:email.split('@')[0], email, passHash:'', avatar:avatarForProfile({email}), createdAt:Date.now(), prefs:accountPrefs(), salt:'', iter:0, methods:['passkey'] };
    const accounts=loadAccounts(); accounts.push(acc); await saveAccounts(accounts);
  } else { acc.methods=acc.methods||[]; if(!acc.methods.includes('passkey')) acc.methods.push('passkey'); }
  const idx=loadPasskeyIndex(); idx[credId]={accountId:acc.id,userId:userIdB64}; savePasskeyIndex(idx);
  await saveAccounts(loadAccounts().map(a=>a.id===acc.id?acc:a));
  setSessionId(acc.id); sessionDataKey=null;
  toast('Passkey added for '+email,'ok'); onSignedIn(acc);
}
async function passkeyLogin(){
  if(!await passkeySupported()){ toast('Passkeys need a secure context (https/localhost) and a recent browser','err'); return; }
  // Offer the stored credentials as allowCredentials so both resident and
  // non-resident keys work; if none are known we let the platform discover.
  const known=Object.keys(loadPasskeyIndex()).map(cid=>({ type:'public-key', id:b64urlToBytes(cid) }));
  let assertion;
  try{
    assertion=await navigator.credentials.get({ publicKey:{
      challenge:b64urlToBytes(bytesToB64url(crypto.getRandomValues(new Uint8Array(32)))),
      rpId:location.hostname, userVerification:'preferred', timeout:60000,
      allowCredentials: known,
    }});
  }catch(e){ toast('Passkey sign-in cancelled','err'); return; }
  const credId=bytesToB64url(assertion.rawId);
  const rec=loadPasskeyIndex()[credId];
  const acc=rec?loadAccounts().find(a=>a.id===rec.accountId):null;
  if(!acc){ toast('No local account is linked to this passkey on this device','err'); return; }
  setSessionId(acc.id); sessionDataKey=null; onSignedIn(acc);
}
function loadPasskeyIndex(){ try{ return JSON.parse(localStorage.getItem('lp_passkeys')||'{}')||{}; }catch(e){ return {}; } }
function savePasskeyIndex(o){ try{ localStorage.setItem('lp_passkeys', JSON.stringify(o)); }catch(e){} }

/* ---- SSO button states (disable when no client ID configured) ---- */
function refreshSSOButtons(){
  ['google','apple','github','discord'].forEach(p=>{
    const btn=$('sso'+p.charAt(0).toUpperCase()+p.slice(1));
    if(!btn) return;
    const has = p==='github' ? (ssoClientId('github') && (S.githubProxy||'').trim()) : ssoClientId(p);
    btn.disabled=!has; btn.style.opacity=has?'1':'.45';
    btn.title = has ? ('Sign in with '+providerLabel(p))
      : (p==='github' && ssoClientId('github') ? 'Add a GitHub CORS proxy in Settings'
        : ('Add your '+providerLabel(p)+' client ID in Settings'));
  });
  const pk=$('ssoPasskey'); if(pk) pk.disabled=!navigator.credentials;
}

/* ============================================================
   Shareable transcript link (backend-free)
   ------------------------------------------------------------
   The conversation is gzipped, base64url-encoded, and placed in the
   URL hash. Opening the link renders a read-only transcript — no server,
   no upload. A 'g' prefix marks gzip, 'r' marks raw base64 fallback.
   ============================================================ */
async function gzipB64url(str){
  if(!window.CompressionStream) return 'r'+btoa(unescape(encodeURIComponent(str)));
  const cs=new CompressionStream('gzip');
  const buf=await new Response(new Blob([str]).stream().pipeThrough(cs)).arrayBuffer();
  return 'g'+bytesToB64url(buf);
}
async function gunzipB64url(s){
  const kind=s[0], payload=s.slice(1), bytes=b64urlToBytes(payload);
  if(kind==='r') return decodeURIComponent(escape(atob(payload)));
  const ds=new DecompressionStream('gzip');
  const buf=await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new TextDecoder().decode(buf);
}
async function shareTranscript(){
  if(!turns.length){ toast('Nothing to share yet','err'); return; }
  const payload=turns.map(t=>({s:t.speaker,sc:t.srcCode,dc:t.dstCode,o:t.orig,tr:t.trans,f:t.feedback?{sc:t.feedback.score,n:t.feedback.notes,fx:t.feedback.fix}:null,ts:t.ts}));
  const link=location.origin+location.pathname+'#t='+await gzipB64url(JSON.stringify(payload));
  try{ await navigator.clipboard.writeText(link); toast('Share link copied to clipboard','ok'); }
  catch(e){ window.prompt('Copy this share link:', link); }
  // also open the read-only view of what we just shared
  location.hash='t='+link.split('#t=')[1];
}
function enterShareView(data){
  S=Object.assign({}, DEFAULT_SETTINGS);
  hideAuth(); document.body.classList.add('share-mode');
  $('orb').style.display='none'; $('captionBox').style.display='none';
  document.querySelector('.controls').style.display='none'; $('langbar').style.display='none';
  turns=(Array.isArray(data)?data:[]).map((t,i)=>({ id:'sh'+i, speaker:t.s||'A', srcCode:t.sc||'en-US', dstCode:t.dc||'es-ES', orig:t.o||'', trans:t.tr||'', feedback:t.f?{score:t.f.sc,notes:t.f.n,fix:t.f.fx}:null, ts:t.ts||Date.now(), star:false, demo:true }));
  // inject a share banner
  let banner=document.getElementById('shareBanner');
  if(!banner){ banner=document.createElement('div'); banner.id='shareBanner'; banner.className='share-banner'; document.querySelector('.app').prepend(banner); }
  banner.hidden=false;
  banner.innerHTML='<span>🔗 <strong>Shared transcript</strong> — read only. '+(turns.length)+' turns.</span><button class="ghost-btn sm" id="shareStartOwn" type="button">Start your own</button>';
  $('shareStartOwn').onclick=()=>{ location.hash=''; location.reload(); };
  updateCount(); renderFeed();
}

async function boot(){
  window.addEventListener('error', e => toast('⚠ ' + (e.message || 'Script error'), 'err'));
  window.addEventListener('unhandledrejection', e => toast('⚠ ' + ((e.reason && e.reason.message) || 'Unexpected error'), 'err'));
  applyTheme();
  buildSpectrum();
  // load encrypted settings + accounts, then build the UI that depends on them
  S = await loadSettings();
  applyAccent();
  await reloadAccounts();
  paintLangChips();
  wire();
  updateCount();
  initAuth();
  refreshSSOButtons();

  // ---- shared transcript (read-only) via #t= hash: no auth, no server ----
  if(location.hash.startsWith('#t=')){
    try{
      const data = JSON.parse(await gunzipB64url(location.hash.slice(3)));
      enterShareView(data);
      return;
    }catch(e){ /* corrupt/invalid link → fall through to the normal app */ toast('That share link could not be opened','err'); }
  }

  const sid = getSessionId();
  let guest = false; try{ guest = localStorage.getItem('lp_guest') === '1'; }catch(e){}
  if(sid){
    const acc = currentAccount();
    if(acc){
      // Account history is encrypted under a password-derived key that is never persisted,
      // so after a restart the app stays usable but the history is locked until re-auth.
      if(HAS_SUBTLE && acc.salt && acc.iter){
        applyAccountToSettings(acc);          // restore settings/languages so the app works immediately
        historyLocked = true;                  // history stays encrypted until the password is re-entered
        renderFeed(); setCaption('History is locked — sign in to view your past conversations.');
        showHistoryLock();
      } else {
        // legacy account or non-secure context (no crypto.subtle): device-key only, auto-restore
        applyAccountToSettings(acc); await loadContextHistory();
      }
    }
    else { clearSessionId(); showAuth(); }
  } else if(guest){ hideAuth(); await loadContextHistory(); }
  else { showAuth(); }
  if(!supported()){
    $('hint').innerHTML = 'Speech recognition isn’t available in this browser. Open the file in <b>Chrome</b> or <b>Edge</b>, or run the demo to see how it works.';
    setCaption('Speech recognition unavailable — use Chrome/Edge or the Demo.');
  }

  // ---- pre-deployment readiness notices ----
  if(!window.isSecureContext){
    showDeployBanner('err',
      'Live microphone translation needs a <b>secure (HTTPS)</b> connection. This page is served over ' +
      '<b>' + location.protocol + '//' + location.host + '</b>, so the mic won’t work here. Host it on ' +
      '<b>https://</b> — or open it from <b>localhost</b> — to enable it.');
  } else if(!supported()){
    showDeployBanner('warn',
      'Speech recognition isn’t built into this browser. Use <b>Chrome</b> or <b>Edge</b> for live translation, ' +
      'or tap <b>Demo</b> to watch a sample conversation.');
  }

  // ---- offline PWA (service worker) — caches the app shell so it opens without a network ----
  if('serviceWorker' in navigator && window.isSecureContext){
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if(location.protocol === 'file:' && supported()){
    toast('Tip: serve this folder over http://localhost for the most reliable mic access');
  }
}
document.addEventListener('DOMContentLoaded', boot);
