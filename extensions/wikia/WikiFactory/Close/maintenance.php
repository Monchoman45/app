<?php

/**
 * @package MediaWiki
 * @addtopackage maintenance
 */

ini_set( "include_path", dirname(__FILE__)."/../../../../maintenance/" );
require_once( "commandLine.inc" );
require_once( "CloseWikiMaintenace.php" );

$setup = isset( $options[ "setup" ] ) ? true : false;
$maintenance = new CloseWikiMaintenace( $options );
$maintenance->execute( $setup );
