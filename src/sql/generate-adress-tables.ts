export const generateAddressTablesSql = `
-- ============================================================
-- SEED: Zonas de Cobertura - Rosario, Santa Fe
-- Coordenadas aproximadas de barrios principales
-- ============================================================

BEGIN;

-- Limpiar datos existentes (opcional, descomentar si es necesario)
-- DELETE FROM business_coverage_zone WHERE business_id = 'e89dfb88-a409-4818-a01e-37d7d5ba2e11';

-- ============================================================
-- ZONA 1: CENTRO (Microcentro y alrededores)
-- Radio: Aprox 1.5km desde el Monumento
-- Delivery: $400 | Mínimo: $2000 | Tiempo: 25 min
-- ============================================================

INSERT INTO business_coverage_zone (
    business_id,
    name,
    description,
    coverage_area,
    delivery_fee,
    min_order_amount,
    estimated_delivery_minutes,
    priority,
    schedule_override
) VALUES (
    'e89dfb88-a409-4818-a01e-37d7d5ba2e11', -- REEMPLAZAR CON TU business.id real
    'Centro',
    'Microcentro, Monumento a la Bandera, Puerto, Parque España, Paseo del Siglo',
    ST_GeogFromText('POLYGON((
        -60.6500 -32.9400,
        -60.6300 -32.9400,
        -60.6200 -32.9550,
        -60.6300 -32.9650,
        -60.6500 -32.9650,
        -60.6600 -32.9550,
        -60.6500 -32.9400
    ))'),
    400.00,     -- $400 envío
    2000.00,    -- Mínimo $2000
    25,         -- 25 minutos
    100,        -- Máxima prioridad
    '{"mon":{"start":"08:00","end":"23:00"},"tue":{"start":"08:00","end":"23:00"},"wed":{"start":"08:00","end":"23:00"},"thu":{"start":"08:00","end":"23:00"},"fri":{"start":"08:00","end":"00:00"},"sat":{"start":"09:00","end":"00:00"},"sun":{"start":"09:00","end":"23:00"}}'::jsonb
);

-- ============================================================
-- ZONA 2: MACROCENTRO NORTE (Barrio Martín, Abasto, etc)
-- Delivery: $500 | Mínimo: $2500 | Tiempo: 30 min
-- ============================================================

INSERT INTO business_coverage_zone (
    business_id,
    name,
    description,
    coverage_area,
    delivery_fee,
    min_order_amount,
    estimated_delivery_minutes,
    priority
) VALUES (
    'e89dfb88-a409-4818-a01e-37d7d5ba2e11',
    'Macrocentro Norte',
    'Barrio Martín, Abasto, Echesortu, La Sexta, Pichincha, Empalme Graneros',
    ST_GeogFromText('POLYGON((
        -60.6500 -32.9400,
        -60.6800 -32.9400,
        -60.7000 -32.9550,
        -60.6900 -32.9750,
        -60.6600 -32.9750,
        -60.6500 -32.9650,
        -60.6500 -32.9400
    ))'),
    500.00,
    2500.00,
    30,
    90
);

-- ============================================================
-- ZONA 3: MACROCENTRO SUR (Barrio Pichincha sur, Sur, Industrial)
-- Delivery: $550 | Mínimo: $2500 | Tiempo: 35 min
-- ============================================================

INSERT INTO business_coverage_zone (
    business_id,
    name,
    description,
    coverage_area,
    delivery_fee,
    min_order_amount,
    estimated_delivery_minutes,
    priority
) VALUES (
    'e89dfb88-a409-4818-a01e-37d7d5ba2e11',
    'Macrocentro Sur',
    'Barrio Pichincha (sur), Barrio Sur, Puerto Norte, Parque Industrial, Villa Gobernador Gálvez (norte)',
    ST_GeogFromText('POLYGON((
        -60.6500 -32.9650,
        -60.6600 -32.9750,
        -60.6500 -32.9900,
        -60.6300 -32.9950,
        -60.6100 -32.9850,
        -60.6200 -32.9700,
        -60.6300 -32.9650,
        -60.6500 -32.9650
    ))'),
    550.00,
    2500.00,
    35,
    80
);

-- ============================================================
-- ZONA 4: BARRIOS NORTE (Fisherton, Alberdi, Alem)
-- Delivery: $650 | Mínimo: $3500 | Tiempo: 40 min
-- ============================================================

INSERT INTO business_coverage_zone (
    business_id,
    name,
    description,
    coverage_area,
    delivery_fee,
    min_order_amount,
    estimated_delivery_minutes,
    priority
) VALUES (
    'e89dfb88-a409-4818-a01e-37d7d5ba2e11',
    'Barrios Norte',
    'Fisherton, Alberdi, Alem, Rucci, Belgrano, Las Delicias, Ludueña',
    ST_GeogFromText('POLYGON((
        -60.6800 -32.9400,
        -60.7200 -32.9300,
        -60.7400 -32.9500,
        -60.7300 -32.9700,
        -60.7000 -32.9750,
        -60.6900 -32.9550,
        -60.6800 -32.9400
    ))'),
    650.00,
    3500.00,
    40,
    70
);

-- ============================================================
-- ZONA 5: BARRIOS OESTE (Funes, Roldán, Ibarlucea - Zona cercana)
-- Delivery: $800 | Mínimo: $5000 | Tiempo: 50 min
-- ============================================================

INSERT INTO business_coverage_zone (
    business_id,
    name,
    description,
    coverage_area,
    delivery_fee,
    min_order_amount,
    estimated_delivery_minutes,
    priority
) VALUES (
    'e89dfb88-a409-4818-a01e-37d7d5ba2e11',
    'Gran Rosario Oeste',
    'Funes (este), Roldán (este), Ibarlucea, Perez, Villa Gobernador Gálvez (centro)',
    ST_GeogFromText('POLYGON((
        -60.7000 -32.9750,
        -60.7300 -32.9700,
        -60.7600 -32.9900,
        -60.7500 -33.0200,
        -60.7200 -33.0300,
        -60.6900 -33.0100,
        -60.7000 -32.9900,
        -60.7000 -32.9750
    ))'),
    800.00,
    5000.00,
    50,
    60
);

-- ============================================================
-- ZONA 6: BARRIOS SUR (Acebal, Fighiera, Zavalla - Zona cercana)
-- Delivery: $750 | Mínimo: $4500 | Tiempo: 45 min
-- ============================================================

INSERT INTO business_coverage_zone (
    business_id,
    name,
    description,
    coverage_area,
    delivery_fee,
    min_order_amount,
    estimated_delivery_minutes,
    priority
) VALUES (
    'e89dfb88-a409-4818-a01e-37d7d5ba2e11',
    'Gran Rosario Sur',
    'Acebal, Fighiera, Zavalla, Pueblo Esther, General Lagos',
    ST_GeogFromText('POLYGON((
        -60.6500 -32.9900,
        -60.6900 -33.0100,
        -60.6800 -33.0400,
        -60.6400 -33.0500,
        -60.6100 -33.0300,
        -60.6200 -33.0000,
        -60.6300 -32.9950,
        -60.6500 -32.9900
    ))'),
    750.00,
    4500.00,
    45,
    60
);

-- ============================================================
-- ZONA 7: BARRIOS ESTE (Granadero Baigorria, Capitán Bermúdez)
-- Delivery: $700 | Mínimo: $4000 | Tiempo: 45 min
-- ============================================================

INSERT INTO business_coverage_zone (
    business_id,
    name,
    description,
    coverage_area,
    delivery_fee,
    min_order_amount,
    estimated_delivery_minutes,
    priority
) VALUES (
    'e89dfb88-a409-4818-a01e-37d7d5ba2e11',
    'Gran Rosario Este',
    'Granadero Baigorria, Capitán Bermúdez, Puerto General San Martín, San Lorenzo (norte)',
    ST_GeogFromText('POLYGON((
        -60.6200 -32.9700,
        -60.6100 -32.9850,
        -60.5800 -32.9900,
        -60.5600 -32.9700,
        -60.5700 -32.9500,
        -60.6000 -32.9400,
        -60.6200 -32.9500,
        -60.6200 -32.9700
    ))'),
    700.00,
    4000.00,
    45,
    65
);

-- ============================================================
-- ZONA 8: ISLAS DEL PARANÁ (Puerto de Rosario, islas cercanas)
-- Solo disponible fines de semana, delivery especial
-- Delivery: $1200 | Mínimo: $8000 | Tiempo: 60 min
-- ============================================================

INSERT INTO business_coverage_zone (
    business_id,
    name,
    description,
    coverage_area,
    delivery_fee,
    min_order_amount,
    estimated_delivery_minutes,
    priority,
    schedule_override
) VALUES (
    'e89dfb88-a409-4818-a01e-37d7d5ba2e11',
    'Islas y Zona Ribereña',
    'Islas del Paraná (cercanas), balnearios, zona ribereña especial. Solo fines de semana.',
    ST_GeogFromText('POLYGON((
        -60.6300 -32.9400,
        -60.6200 -32.9300,
        -60.6000 -32.9200,
        -60.5800 -32.9300,
        -60.5700 -32.9400,
        -60.5800 -32.9500,
        -60.6000 -32.9400,
        -60.6200 -32.9500,
        -60.6300 -32.9400
    ))'),
    1200.00,
    8000.00,
    60,
    40,
    '{"sat":{"start":"10:00","end":"18:00"},"sun":{"start":"10:00","end":"18:00"}}'::jsonb
);

COMMIT;

-- ============================================================
-- VERIFICACIÓN: Ver zonas creadas
-- ============================================================

SELECT 
    name,
    description,
    delivery_fee,
    min_order_amount,
    estimated_delivery_minutes,
    priority,
    ST_Area(coverage_area)/1000000 as area_km2
FROM business_coverage_zone 
WHERE business_id = 'e89dfb88-a409-4818-a01e-37d7d5ba2e11'
ORDER BY priority DESC;
`;