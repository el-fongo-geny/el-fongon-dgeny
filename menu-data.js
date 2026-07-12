const TAX_RATE_SAN_JOSE_CA = 0.10;

const UI_TEXT = {
  es: {
    heroTitle: "Menú",
    heroSubtitle: "Haz tu pedido y recógelo en la ventanilla del camión.",
    cart: "Carrito",
    yourOrder: "Tu pedido",
    subtotal: "Subtotal",
    tax: "Impuestos",
    name: "Nombre",
    phone: "Teléfono",
    phoneNote: "Te avisaremos por WhatsApp o mensaje cuando tu pedido esté listo.",
    sendOrder: "Enviar pedido",
    addToCart: "Agregar",
    notes: "Notas especiales",
    optional: "Opcional",
    required: "Obligatorio",
    remove: "Eliminar",
    emptyCart: "Tu carrito está vacío.",
    chooseRequired: "Completa las opciones obligatorias.",
    paymentTitle: "¿Cómo pagarás?",
    paymentSubtitle: "El pago se realiza en la ventanilla.",
    cardAtWindow: "Tarjeta en ventanilla",
    cashAtWindow: "Efectivo en ventanilla",
    orderSent: "Pedido enviado. Te avisaremos cuando esté listo.",
    unavailable: "Agotado",
    darkMode: "Modo oscuro",
    lightMode: "Modo claro"
  },
  en: {
    heroTitle: "Menu",
    heroSubtitle: "Place your order and pick it up at the truck window.",
    cart: "Cart",
    yourOrder: "Your order",
    subtotal: "Subtotal",
    tax: "Tax",
    name: "Name",
    phone: "Phone",
    phoneNote: "We will notify you by WhatsApp or text when your order is ready.",
    sendOrder: "Send order",
    addToCart: "Add",
    notes: "Special instructions",
    optional: "Optional",
    required: "Required",
    remove: "Remove",
    emptyCart: "Your cart is empty.",
    chooseRequired: "Complete the required options.",
    paymentTitle: "How will you pay?",
    paymentSubtitle: "Payment is made at the pickup window.",
    cardAtWindow: "Card at window",
    cashAtWindow: "Cash at window",
    orderSent: "Order sent. We will notify you when it is ready.",
    unavailable: "Sold out",
    darkMode: "Dark mode",
    lightMode: "Light mode"
  }
};

const CATEGORIES = [
  { id: "platos-fuertes", es: "Platos fuertes", en: "Main Plates" },
  { id: "desayuno", es: "Desayunos y sándwiches", en: "Breakfast & Sandwiches" },
  { id: "kids", es: "Menú de niños", en: "Kids Menu" },
  { id: "antojitos", es: "Antojitos", en: "Small Bites" },
  { id: "acompanamientos", es: "Acompañamientos", en: "Sides" },
  { id: "postres", es: "Postres", en: "Desserts" },
  { id: "jugos", es: "Jugos y batidas", en: "Juices & Shakes" },
  { id: "bebidas", es: "Bebidas", en: "Drinks" }
];

const PROTEINS = [
  { id: "pollo-guisado", es: "Pollo guisado", en: "Stewed chicken", price: 0 },
  { id: "res-guisada", es: "Res guisada", en: "Stewed beef", price: 0 },
  { id: "puerco-guisado", es: "Puerco guisado", en: "Stewed pork", price: 0 },
  { id: "bistec", es: "Bistec", en: "Steak", price: 0 },
  { id: "chuleta-plancha", es: "Chuleta a la plancha", en: "Grilled pork chop", price: 0 },
  { id: "bacalao", es: "Bacalao", en: "Codfish", price: 0 },
  { id: "arenque", es: "Arenque", en: "Herring", price: 0 },
  { id: "pechuga-plancha", es: "Pechuga a la plancha", en: "Grilled chicken breast", price: 0 }
];

const EXTRA_AVOCADO = { id: "aguacate-extra", es: "Aguacate extra", en: "Extra avocado", price: 1 };
const EXTRA_MEAT = { id: "carne-extra", es: "Carne extra", en: "Extra meat", price: 4.5 };

const MENU_ITEMS = [
  {
    id: "bandera",
    category: "platos-fuertes",
    es: "La Bandera Dominicana",
    en: "Dominican Flag Plate",
    description: { es: "Arroz, habichuelas, plátano maduro y proteína.", en: "Rice, beans, sweet plantain and protein." },
    price: 20,
    image: "assets/images/bandera.png",
    taxable: true,
    optionGroups: [{ id: "proteina", es: "Elige tu proteína", en: "Choose your protein", required: true, type: "single", options: PROTEINS }],
    extras: [EXTRA_AVOCADO, EXTRA_MEAT]
  },
  {
    id: "moro-guandules-bandera",
    category: "platos-fuertes",
    es: "Moro de Guandules (Bandera)",
    en: "Rice with Pigeon Peas (Flag Plate)",
    description: { es: "Moro de guandules con coco, proteína y acompañamientos.", en: "Rice with pigeon peas and coconut, protein and sides." },
    price: 22,
    image: "assets/images/moro-guandules-plato.png",
    taxable: true,
    optionGroups: [{ id: "proteina", es: "Elige tu proteína", en: "Choose your protein", required: true, type: "single", options: PROTEINS }],
    extras: [EXTRA_AVOCADO, EXTRA_MEAT]
  },
  {
    id: "moro-habichuelas-bandera",
    category: "platos-fuertes",
    es: "Moro de Habichuelas (Bandera)",
    en: "Rice with Beans (Flag Plate)",
    description: { es: "Moro de habichuelas con proteína y acompañamientos.", en: "Rice with beans, protein and sides." },
    price: 22,
    image: "assets/images/moro-habichuelas-plato.png",
    taxable: true,
    optionGroups: [{ id: "proteina", es: "Elige tu proteína", en: "Choose your protein", required: true, type: "single", options: PROTEINS }],
    extras: [EXTRA_AVOCADO, EXTRA_MEAT]
  },
  {
    id: "mofongo",
    category: "platos-fuertes",
    es: "Mofongo",
    en: "Mofongo",
    description: { es: "Mofongo dominicano con proteína a elección.", en: "Dominican mofongo with your choice of protein." },
    price: 22,
    image: "assets/images/mofongo.png",
    taxable: true,
    optionGroups: [
      {
        id: "base",
        es: "Base de mofongo",
        en: "Mofongo base",
        required: true,
        type: "single",
        options: [
          { id: "con-chicharron", es: "Con base de chicharrón", en: "With pork rind base", price: 0 },
          { id: "sin-chicharron", es: "Sin base de chicharrón", en: "Without pork rind base", price: 0 }
        ]
      },
      {
        id: "proteina",
        es: "Elige tu proteína",
        en: "Choose your protein",
        required: true,
        type: "single",
        options: [
          { id: "pollo-frito", es: "Pollo frito", en: "Fried chicken", price: 0 },
          { id: "camaron", es: "Camarón", en: "Shrimp", price: 0 },
          { id: "chicharron", es: "Chicharrón", en: "Pork rinds", price: 0 },
          { id: "bistec", es: "Bistec", en: "Steak", price: 0 }
        ]
      }
    ],
    extras: [EXTRA_AVOCADO],
    removables: [
      { id: "sin-queso-frito", es: "Sin queso frito", en: "No fried cheese" },
      { id: "sin-salsa-bechamel", es: "Sin salsa bechamel", en: "No bechamel sauce" },
      { id: "sin-ajo", es: "Sin ajo", en: "No garlic" }
    ]
  },
  {
    id: "pescado-frito-entero",
    category: "platos-fuertes",
    es: "Pescado Frito Entero",
    en: "Whole Fried Fish",
    description: { es: "Tilapia o chillo con acompañamiento.", en: "Tilapia or red snapper with a side." },
    price: 25,
    image: "assets/images/pescado-frito-entero.png",
    taxable: true,
    optionGroups: [
      {
        id: "tipo-pescado",
        es: "Tipo de pescado",
        en: "Fish type",
        required: true,
        type: "single",
        options: [
          { id: "tilapia", es: "Tilapia", en: "Tilapia", price: 0 },
          { id: "chillo", es: "Chillo / Red Snapper", en: "Red snapper", price: 8 }
        ]
      },
      {
        id: "acompanamiento",
        es: "Acompañamiento",
        en: "Side",
        required: true,
        type: "single",
        options: [
          { id: "tostones", es: "Tostones", en: "Tostones", price: 0 },
          { id: "papas-fritas", es: "Papas fritas", en: "French fries", price: 0 }
        ]
      }
    ]
  },
  {
    id: "chuleta-plancha",
    category: "platos-fuertes",
    es: "Chuleta a la Plancha",
    en: "Grilled Pork Chop",
    description: { es: "Chuleta a la plancha con acompañamiento.", en: "Grilled pork chop with a side." },
    price: 20,
    image: "assets/images/chuleta-plancha.png",
    taxable: true,
    optionGroups: [
      {
        id: "acompanamiento",
        es: "Acompañamiento",
        en: "Side",
        required: true,
        type: "single",
        options: [
          { id: "papas-fritas", es: "Papas fritas", en: "French fries", price: 0 },
          { id: "platanos-fritos", es: "Plátanos fritos", en: "Fried plantains", price: 0 }
        ]
      }
    ],
    extras: [EXTRA_AVOCADO]
  },
  {
    id: "pica-pollo",
    category: "platos-fuertes",
    es: "Pica Pollo",
    en: "Dominican Fried Chicken",
    description: { es: "Pollo frito dominicano con acompañamiento.", en: "Dominican fried chicken with a side." },
    price: 20,
    image: "assets/images/pica-pollo.png",
    taxable: true,
    optionGroups: [
      {
        id: "acompanamiento",
        es: "Acompañamiento",
        en: "Side",
        required: true,
        type: "single",
        options: [
          { id: "papas-fritas", es: "Papas fritas", en: "French fries", price: 0 },
          { id: "platanos-fritos", es: "Plátanos fritos", en: "Fried plantains", price: 0 }
        ]
      }
    ],
    extras: [EXTRA_AVOCADO]
  },
  {
    id: "alitas",
    category: "platos-fuertes",
    es: "Alitas",
    en: "Chicken Wings",
    description: { es: "Alitas de pollo con opción normal o picante.", en: "Chicken wings with regular or spicy option." },
    price: 20,
    image: "assets/images/alitas.png",
    taxable: true,
    optionGroups: [
      {
        id: "tipo-alitas",
        es: "Tipo de alitas",
        en: "Wing style",
        required: true,
        type: "single",
        options: [
          { id: "normales", es: "Normales", en: "Regular", price: 0 },
          { id: "picantes", es: "Picantes", en: "Spicy", price: 0 }
        ]
      },
      {
        id: "acompanamiento",
        es: "Acompañamiento",
        en: "Side",
        required: true,
        type: "single",
        options: [
          { id: "papas-fritas", es: "Papas fritas", en: "French fries", price: 0 },
          { id: "tostones", es: "Tostones", en: "Tostones", price: 0 }
        ]
      }
    ],
    extras: [EXTRA_AVOCADO]
  },
  {
    id: "yaroa",
    category: "platos-fuertes",
    es: "Yaroa",
    en: "Yaroa",
    description: { es: "Yaroa con base y proteína a elección.", en: "Yaroa with your choice of base and protein." },
    price: 20,
    image: "assets/images/yaroa.png",
    taxable: true,
    optionGroups: [
      {
        id: "base",
        es: "Base",
        en: "Base",
        required: true,
        type: "single",
        options: [
          { id: "papas-fritas", es: "Papas fritas", en: "French fries", price: 0 },
          { id: "platanos-maduros", es: "Plátanos maduros", en: "Sweet plantains", price: 0 }
        ]
      },
      {
        id: "proteina",
        es: "Proteína",
        en: "Protein",
        required: true,
        type: "single",
        options: [
          { id: "res", es: "Res", en: "Beef", price: 0 },
          { id: "pollo", es: "Pollo", en: "Chicken", price: 0 }
        ]
      }
    ],
    extras: [EXTRA_AVOCADO]
  },
  {
    id: "fritura-combinada",
    category: "platos-fuertes",
    es: "Fritura Combinada",
    en: "Mixed Fried Platter",
    description: { es: "Combinación dominicana con acompañamiento.", en: "Dominican mixed platter with a side." },
    price: 24,
    image: "assets/images/fritura-combinada.png",
    taxable: true,
    optionGroups: [
      {
        id: "acompanamiento",
        es: "Acompañamiento",
        en: "Side",
        required: true,
        type: "single",
        options: [
          { id: "tostones", es: "Tostones", en: "Tostones", price: 0 },
          { id: "papas-fritas", es: "Papas fritas", en: "French fries", price: 0 }
        ]
      }
    ],
    extras: [EXTRA_AVOCADO]
  },
  {
    id: "sancocho",
    category: "platos-fuertes",
    es: "Sancocho",
    en: "Sancocho",
    description: { es: "Sopa dominicana tradicional.", en: "Traditional Dominican stew." },
    price: 20,
    image: "assets/images/sancocho.png",
    taxable: true,
    extras: [EXTRA_AVOCADO]
  },
  {
    id: "tres-golpes",
    category: "desayuno",
    es: "Tres Golpes",
    en: "Tres Golpes",
    description: { es: "Desayuno dominicano tradicional.", en: "Traditional Dominican breakfast." },
    price: 18,
    image: "assets/images/tres-golpes.png",
    taxable: true
  },
  {
    id: "sandwich-dominicano",
    category: "desayuno",
    es: "Sándwich Dominicano",
    en: "Dominican Sandwich",
    description: { es: "Sándwich dominicano con acompañamiento.", en: "Dominican sandwich with a side." },
    price: 18,
    image: "assets/images/sandwich-dominicano.png",
    taxable: true,
    optionGroups: [
      {
        id: "acompanamiento",
        es: "Acompañamiento",
        en: "Side",
        required: true,
        type: "single",
        options: [
          { id: "papas-fritas", es: "Papas fritas", en: "French fries", price: 0 },
          { id: "tostones", es: "Tostones", en: "Tostones", price: 0 }
        ]
      }
    ]
  },
  {
    id: "chimi",
    category: "desayuno",
    es: "Chimi",
    en: "Dominican Chimi Burger",
    description: { es: "Chimi dominicano con carne, repollo, tomate, cebolla, queso y salsa mayo-ketchup.", en: "Dominican chimi burger with meat, cabbage, tomato, onion, cheese and mayo-ketchup." },
    price: 20,
    image: "assets/images/chimi.png",
    taxable: true,
    optionGroups: [
      {
        id: "acompanamiento",
        es: "Acompañamiento",
        en: "Side",
        required: true,
        type: "single",
        options: [
          { id: "papas-fritas", es: "Papas fritas", en: "French fries", price: 0 },
          { id: "tostones", es: "Tostones", en: "Tostones", price: 0 }
        ]
      }
    ],
    removables: [
      { id: "sin-repollo", es: "Sin repollo", en: "No cabbage" },
      { id: "sin-tomate", es: "Sin tomate", en: "No tomato" },
      { id: "sin-cebolla", es: "Sin cebolla", en: "No onion" },
      { id: "sin-queso", es: "Sin queso", en: "No cheese" },
      { id: "sin-mayo-ketchup", es: "Sin mayo-ketchup", en: "No mayo-ketchup" }
    ]
  },
  {
    id: "tostada-dominicana",
    category: "desayuno",
    es: "Tostada Dominicana",
    en: "Dominican Toasted Sandwich",
    description: { es: "Tostada dominicana con papas fritas.", en: "Dominican toasted sandwich with fries." },
    price: 14,
    image: "assets/images/tostada-dominicana.png",
    taxable: true
  },
  {
    id: "burritos",
    category: "desayuno",
    es: "Burritos",
    en: "Burritos",
    description: { es: "Burrito con proteína a elección.", en: "Burrito with your choice of protein." },
    price: 18,
    image: "assets/images/burritos.png",
    taxable: true,
    optionGroups: [
      {
        id: "proteina",
        es: "Proteína",
        en: "Protein",
        required: true,
        type: "single",
        options: [
          { id: "pollo", es: "Pollo", en: "Chicken", price: 0 },
          { id: "res", es: "Res", en: "Beef", price: 0 },
          { id: "puerco", es: "Puerco", en: "Pork", price: 0 }
        ]
      }
    ]
  },
  {
    id: "quesadilla",
    category: "desayuno",
    es: "Quesadilla",
    en: "Quesadilla",
    description: { es: "Quesadilla con proteína a elección.", en: "Quesadilla with your choice of protein." },
    price: 16,
    image: "assets/images/quesadilla.png",
    taxable: true,
    optionGroups: [
      {
        id: "proteina",
        es: "Proteína",
        en: "Protein",
        required: true,
        type: "single",
        options: [
          { id: "pollo", es: "Pollo", en: "Chicken", price: 0 },
          { id: "res", es: "Res", en: "Beef", price: 0 },
          { id: "puerco", es: "Puerco", en: "Pork", price: 0 }
        ]
      }
    ]
  },
  {
    id: "mini-bandera-kids",
    category: "kids",
    es: "Mini Bandera",
    en: "Mini Flag Plate",
    description: { es: "Versión infantil de la bandera dominicana.", en: "Kids version of the Dominican flag plate." },
    price: 12,
    image: "assets/images/mini-bandera-kids.png",
    taxable: true,
    optionGroups: [{ id: "proteina", es: "Elige tu proteína", en: "Choose your protein", required: true, type: "single", options: PROTEINS }]
  },
  {
    id: "pica-pollo-kid",
    category: "kids",
    es: "Pica Pollo de Niño",
    en: "Kids Dominican Fried Chicken",
    description: { es: "Pica pollo infantil.", en: "Kids fried chicken meal." },
    price: 12,
    image: "assets/images/pica-pollo-kid.png",
    taxable: true
  },
  {
    id: "quesadilla-kids",
    category: "kids",
    es: "Quesadilla de Niño",
    en: "Kids Quesadilla",
    description: { es: "Quesadilla infantil con proteína opcional.", en: "Kids quesadilla with optional protein." },
    price: 10,
    image: "assets/images/quesadilla-kids.png",
    taxable: true,
    optionGroups: [
      {
        id: "proteina",
        es: "Agregar proteína",
        en: "Add protein",
        required: true,
        type: "single",
        options: [
          { id: "pollo", es: "Pollo", en: "Chicken", price: 2 },
          { id: "res", es: "Res", en: "Beef", price: 2 },
          { id: "puerco", es: "Puerco", en: "Pork", price: 2 }
        ]
      }
    ]
  },
  {
    id: "tostones-salami-kids",
    category: "kids",
    es: "Tostones con Salami",
    en: "Tostones with Salami",
    description: { es: "Ración infantil de tostones con salami.", en: "Kids portion of tostones with salami." },
    price: 10,
    image: "assets/images/tostones-salami-kids.png",
    taxable: true
  },
  {
    id: "chulitos-de-yuca",
    category: "antojitos",
    es: "Chulitos de Yuca",
    en: "Yuca Cheese Bites",
    description: { es: "Chulitos de yuca dominicanos, crujientes por fuera y suaves por dentro.", en: "Dominican yuca bites, crispy outside and soft inside." },
    price: 3.5,
    image: "assets/images/chulitos-de-yuca.png",
    taxable: true,
    optionGroups: [
      {
        id: "cantidad",
        es: "Cantidad",
        en: "Quantity",
        required: true,
        type: "single",
        options: [
          { id: "3-piezas", es: "3 piezas", en: "3 pieces", price: 0 },
          { id: "6-piezas", es: "6 piezas", en: "6 pieces", price: 5.5 }
        ]
      }
    ]
  },
  {
    id: "quipes",
    category: "antojitos",
    es: "Quipes",
    en: "Dominican Kipes",
    description: { es: "Quipes dominicanos rellenos de carne.", en: "Dominican kipes filled with beef." },
    price: 4,
    image: "assets/images/quipes.png",
    taxable: true
  },
  {
    id: "pastel-en-hoja",
    category: "antojitos",
    es: "Pastel en Hoja",
    en: "Pastel en Hoja",
    description: { es: "Pastel dominicano envuelto en hoja.", en: "Dominican plantain tamal wrapped in leaf." },
    price: 7,
    image: "assets/images/pastel-en-hoja.png",
    taxable: true,
    optionGroups: [
      {
        id: "relleno",
        es: "Relleno",
        en: "Filling",
        required: true,
        type: "single",
        options: [
          { id: "pollo", es: "Pollo", en: "Chicken", price: 0 },
          { id: "res", es: "Res", en: "Beef", price: 0 },
          { id: "cerdo", es: "Cerdo", en: "Pork", price: 0 },
          { id: "queso", es: "Queso", en: "Cheese", price: 0 }
        ]
      }
    ]
  },
  {
    id: "empanada-dominicana",
    category: "antojitos",
    es: "Empanada Dominicana",
    en: "Dominican Empanada",
    description: { es: "Empanada con relleno a elección.", en: "Empanada with your choice of filling." },
    price: 5,
    image: "assets/images/empanada-dominicana.png",
    taxable: true,
    optionGroups: [
      {
        id: "relleno",
        es: "Relleno",
        en: "Filling",
        required: true,
        type: "single",
        options: [
          { id: "queso", es: "Queso", en: "Cheese", price: -0.5 },
          { id: "jamon-queso", es: "Jamón y queso", en: "Ham and cheese", price: -0.5 },
          { id: "carne", es: "Carne", en: "Beef", price: 0 },
          { id: "pollo", es: "Pollo", en: "Chicken", price: 0 }
        ]
      }
    ]
  },
  { id: "tostones", category: "acompanamientos", es: "Tostones", en: "Tostones", description: { es: "Orden de tostones.", en: "Order of tostones." }, price: 7, image: "assets/images/tostones.png", taxable: true },
  { id: "aguacate", category: "acompanamientos", es: "Aguacate", en: "Avocado", description: { es: "Porción de aguacate.", en: "Avocado portion." }, price: 2.5, image: "assets/images/aguacate.png", taxable: false },
  { id: "ensalada-rusa", category: "acompanamientos", es: "Ensalada Rusa", en: "Potato Beet Salad", description: { es: "Ensalada rusa dominicana.", en: "Dominican potato beet salad." }, price: 3.5, image: "assets/images/ensalada-rusa.png", taxable: false },
  { id: "ensalada-fresca", category: "acompanamientos", es: "Ensalada Verde", en: "Green Salad", description: { es: "Ensalada fresca.", en: "Fresh green salad." }, price: 4.5, image: "assets/images/ensalada-fresca.png", taxable: false },
  { id: "habichuelas-guisadas", category: "acompanamientos", es: "Habichuelas Guisadas", en: "Stewed Beans", description: { es: "Porción de habichuelas guisadas.", en: "Side of stewed beans." }, price: 4.5, image: "assets/images/habichuelas-guisadas.png", taxable: true },
  { id: "habichuela-con-dulce", category: "postres", es: "Habichuelas con Dulce", en: "Sweet Cream of Beans", description: { es: "Postre dominicano tradicional.", en: "Traditional Dominican dessert." }, price: 8, image: "assets/images/habichuela-con-dulce.png", taxable: false },
  { id: "arroz-con-dulce", category: "postres", es: "Arroz con Dulce", en: "Rice Pudding", description: { es: "Arroz dulce con canela.", en: "Sweet rice pudding with cinnamon." }, price: 5, image: "assets/images/arroz-con-dulce.png", taxable: false },
  { id: "majarete", category: "postres", es: "Majarete", en: "Majarete", description: { es: "Postre dominicano de maíz.", en: "Dominican sweet corn pudding." }, price: 6, image: "assets/images/majarete.png", taxable: false },
  {
    id: "jugo-guanabana",
    category: "jugos",
    es: "Jugo Natural de Guanábana",
    en: "Natural Guanabana Juice",
    description: { es: "Jugo natural con base a elección.", en: "Natural juice with your choice of base." },
    price: 7,
    image: "assets/images/jugo-guanabana.png",
    taxable: false,
    optionGroups: [{ id: "base", es: "Base", en: "Base", required: true, type: "single", options: [{ id: "leche", es: "Con leche", en: "With milk", price: 0 }, { id: "agua", es: "Con agua", en: "With water", price: 0 }] }]
  },
  {
    id: "jugo-chinola",
    category: "jugos",
    es: "Jugo Natural de Chinola",
    en: "Natural Passion Fruit Juice",
    description: { es: "Jugo natural con base a elección.", en: "Natural juice with your choice of base." },
    price: 7,
    image: "assets/images/jugo-chinola.png",
    taxable: false,
    optionGroups: [{ id: "base", es: "Base", en: "Base", required: true, type: "single", options: [{ id: "leche", es: "Con leche", en: "With milk", price: 0 }, { id: "agua", es: "Con agua", en: "With water", price: 0 }] }]
  },
  {
    id: "jugo-tamarindo",
    category: "jugos",
    es: "Jugo Natural de Tamarindo",
    en: "Natural Tamarind Juice",
    description: { es: "Jugo natural con base a elección.", en: "Natural juice with your choice of base." },
    price: 6,
    image: "assets/images/jugo-tamarindo.png",
    taxable: false,
    optionGroups: [{ id: "base", es: "Base", en: "Base", required: true, type: "single", options: [{ id: "leche", es: "Con leche", en: "With milk", price: 0 }, { id: "agua", es: "Con agua", en: "With water", price: 0 }] }]
  },
  { id: "limonada", category: "jugos", es: "Limonada", en: "Lemonade", description: { es: "Jugo natural de limón.", en: "Fresh lemonade." }, price: 6, image: "assets/images/limonada.png", taxable: false },
  {
    id: "batida-zapote",
    category: "jugos",
    es: "Batida de Zapote",
    en: "Mamey Shake",
    description: { es: "Batida con base a elección.", en: "Shake with your choice of base." },
    price: 7,
    image: "assets/images/batida-zapote.png",
    taxable: false,
    optionGroups: [{ id: "base", es: "Base", en: "Base", required: true, type: "single", options: [{ id: "leche", es: "Con leche", en: "With milk", price: 0 }, { id: "agua", es: "Con agua", en: "With water", price: 0 }] }]
  },
  {
    id: "batida-de-lechosa",
    category: "jugos",
    es: "Batida de Lechosa",
    en: "Papaya Shake",
    description: { es: "Batida con base a elección.", en: "Shake with your choice of base." },
    price: 7,
    image: "assets/images/batida-de-lechosa.png",
    taxable: false,
    optionGroups: [{ id: "base", es: "Base", en: "Base", required: true, type: "single", options: [{ id: "leche", es: "Con leche", en: "With milk", price: 0 }, { id: "agua", es: "Con agua", en: "With water", price: 0 }] }]
  },
  { id: "morir-sonando-chinola o limon", category: "jugos", es: "Morir Soñando de Chinola o limon", en: "Passion Fruit Morir Soñando or limón", description: { es: "Bebida dominicana cremosa de chinola.", en: "Creamy Dominican passion fruit drink." }, price: 8, image: "assets/images/morir-sonando-chinola.png", taxable: false },
  { id: "cafe-santo-domingo", category: "bebidas", es: "Café Santo Domingo", en: "Santo Domingo Coffee", description: { es: "Café dominicano.", en: "Dominican coffee." }, price: 5, image: "assets/images/cafe-santo-domingo.png", taxable: false },
  { id: "agua", category: "bebidas", es: "Agua", en: "Water", description: { es: "Agua embotellada.", en: "Bottled water." }, price: 2, image: "assets/images/agua.png", taxable: false },
  { id: "agua-de-coco", category: "bebidas", es: "Agua de Coco", en: "Coconut Water", description: { es: "Agua de coco.", en: "Coconut water." }, price: 4, image: "assets/images/agua-de-coco.png", taxable: false },
  { id: "coca-cola", category: "bebidas", es: "Coca-Cola", en: "Coca-Cola", description: { es: "Refresco Coca-Cola.", en: "Coca-Cola soda." }, price: 4, image: "assets/images/coca-cola.png", taxable: true },
  { id: "sprite", category: "bebidas", es: "Sprite", en: "Sprite", description: { es: "Refresco Sprite.", en: "Sprite soda." }, price: 4, image: "assets/images/sprite.png", taxable: true },
  { id: "malta-india", category: "bebidas", es: "Malta India", en: "Malta India", description: { es: "Malta India.", en: "Malta India." }, price: 5, image: "assets/images/malta-india.png", taxable: true },
  { id: "country-club-frambuesa", category: "bebidas", es: "Country Club Frambuesa", en: "Country Club Raspberry", description: { es: "Refresco dominicano.", en: "Dominican soda." }, price: 5, image: "assets/images/country-club-frambuesa.png", taxable: true },
  { id: "country-club-naranja", category: "bebidas", es: "Country Club Naranja", en: "Country Club Orange", description: { es: "Refresco dominicano.", en: "Dominican soda." }, price: 5, image: "assets/images/country-club-naranja.png", taxable: true }
];
