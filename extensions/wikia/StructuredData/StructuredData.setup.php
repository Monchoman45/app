<?php
$app = F::app();
$dir = dirname(__FILE__) . '/';

/**
 * classes
 */
$app->registerClass('StructuredDataAPIClient', $dir . 'StructuredDataAPIClient.class.php');
$app->registerClass('StructuredData', $dir . 'StructuredData.class.php');
$app->registerClass('SDElement', $dir . 'SDElement.class.php');
$app->registerClass('SDElementProperty', $dir . 'SDElementProperty.class.php');
$app->registerClass('SDContext', $dir . 'SDContext.class.php');

require_once( $dir . '../../../lib/HTTP/Request.php');

/**
 * hooks
 */
//$app->registerHook('OutputPageBeforeHTML', 'HelloWorld', 'onOutputPageBeforeHTML');

/**
 * controllers
 */
$app->registerClass('StructuredDataController', $dir . 'StructuredDataController.class.php');

/**
 * special pages
 */
$app->registerSpecialPage('StructuredData', 'StructuredDataController');

$wgStructuredDataConfig = array(
	//'endpointUrl' => 'http://data.wikia.net/api/v0/',
	'baseUrl' => 'http://data-stage.wikia.net/',
	'apiPath' => 'api/v0/',
	'schemaPath' => 'callofduty'
);

/**
 * message files
 */
//$app->registerExtensionMessageFile('StructuredData', $dir . 'StructuredData.i18n.php');
